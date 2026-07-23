"""Generates data/paracetamol_batch_kpis.csv - one row per batch of completed-batch
KPI outcomes (Yield, OEE, Quality Score, Process Stability, Energy/SEC, Golden Batch
Similarity, Cycle Time), per docs/batch-kpis-design.md.

This is a retrospective/historical-reporting dataset, not a prediction dataset: every
field here is a single end-of-batch value. Per-parameter intermediate components and a
provenance manifest are stored alongside it specifically so a future KPI-prediction
effort (see docs/batch-kpis-prediction-readiness-review.md) doesn't have to regenerate
this data - but no forecasting labels or models are built here.

Imports app.config directly (not app.state.AppState) to reuse the exact
DRYING_WINDOW_*/valid_time_range constants the live API uses, without paying the cost
of loading the ~400MB trained model, which this script never needs.
"""
import hashlib
import json
import math
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'backend'))

from app import config  # noqa: E402

OUT_CSV = REPO_ROOT / 'data' / 'paracetamol_batch_kpis.csv'
OUT_MANIFEST = REPO_ROOT / 'data' / 'paracetamol_batch_kpis_manifest.json'

GENERATION_METHOD_VERSION = 'v1'
GOLDEN_BATCH_ID = 'PAR-GOLDEN'
NOMINAL_BATCH_SIZE_KG = 150.0
BASE_ENERGY_KWH = 180.0
ENERGY_PER_MINUTE_KWH = 0.16
ENERGY_NOISE_STD_KWH = 5.0
OEE_QUALITY_NOISE_STD = 1.0

# (Normal, Warning, Critical) severity-tiered ranges, anchored to the benchmarks
# already documented in kpiDefinitions.ts / mockData.ts's getMockOEEBreakdown.
OEE_PERFORMANCE_RANGES = {'Normal': (90, 98), 'Warning': (82, 92), 'Critical': (75, 88)}
YIELD_RANGES = {'Normal': (97, 99.5), 'Warning': (95, 98), 'Critical': (90, 96)}
QUALITY_SCORE_RANGES = {'Normal': (97, 99.5), 'Warning': (94, 97), 'Critical': (88, 95)}


def seeded_unit_interval(seed: str) -> float:
    digest = hashlib.sha256(seed.encode()).digest()
    return int.from_bytes(digest[:8], 'big') / 2**64


def seeded_range(seed: str, lo: float, hi: float) -> float:
    return lo + seeded_unit_interval(seed) * (hi - lo)


def seeded_gaussian(seed: str, mean: float, std: float) -> float:
    u1 = max(seeded_unit_interval(seed + '_u1'), 1e-9)
    u2 = seeded_unit_interval(seed + '_u2')
    z = math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)
    return mean + z * std


def ground_truth_severity(batches_df: pd.DataFrame, batch_id: str) -> str:
    # Same pandas gotcha fixed repeatedly elsewhere in this codebase: the literal
    # CSV text "None" is parsed as a missing value, not the string "None".
    severity = batches_df.loc[batch_id, 'deviation_severity']
    return 'Normal' if pd.isna(severity) or severity == 'None' else severity


def valid_time_range(batches_df: pd.DataFrame, batch_id: str) -> tuple[int, int]:
    # Identical formula to app.state.AppState.valid_time_range - the same window
    # already used for Golden Batch's Optimal Parameters averaging and the live
    # prediction API, reused here so there is exactly one canonical window
    # definition in the codebase, not several slightly different ones.
    duration = int(batches_df.loc[batch_id, 'batch_duration_minutes'])
    return config.DRYING_WINDOW_START_MINUTES, duration - config.DRYING_WINDOW_END_BUFFER_MINUTES - config.HORIZON_MINUTES


def load_parameter_limits() -> dict[str, tuple[float, float]]:
    param_config = pd.read_csv(config.PARAMETER_CONFIG_CSV).set_index('parameter')
    return {
        key: (float(param_config.loc[name, 'lower_limit']), float(param_config.loc[name, 'upper_limit']))
        for key, name in config.PARAMETER_CONFIG_NAMES.items()
    }


def compute_stability(window: pd.DataFrame, parameter_limits: dict) -> dict:
    fractions = {}
    for param in config.DRYING_PARAMETER_KEYS:
        lower, upper = parameter_limits[param]
        values = window[param]
        fractions[param] = 100.0 * float(((values >= lower) & (values <= upper)).mean()) if len(values) else 0.0
    return fractions


def compute_similarity(window: pd.DataFrame, golden_window: pd.DataFrame, parameter_limits: dict) -> dict:
    merged = window.merge(golden_window, on='elapsed_minutes', suffixes=('', '_golden'))
    similarities = {}
    for param in config.DRYING_PARAMETER_KEYS:
        lower, upper = parameter_limits[param]
        band = upper - lower
        if merged.empty:
            similarities[param] = 0.0
            continue
        mean_abs_diff = float((merged[param] - merged[f'{param}_golden']).abs().mean())
        similarities[param] = 100.0 * (1.0 - min(1.0, mean_abs_diff / band))
    return similarities


def find_fault_onset(window: pd.DataFrame, parameter_limits: dict) -> float:
    ordered = window.sort_values('elapsed_minutes')
    for row in ordered.itertuples():
        for param in config.DRYING_PARAMETER_KEYS:
            lower, upper = parameter_limits[param]
            if not (lower <= getattr(row, param) <= upper):
                return float(row.elapsed_minutes)
    return float('nan')


def main():
    batches_df = pd.read_csv(config.BATCHES_CSV).set_index('batch_id')
    timeseries_df = pd.read_csv(config.TIMESERIES_CSV)
    parameter_limits = load_parameter_limits()

    golden_min_t, golden_max_t = valid_time_range(batches_df, GOLDEN_BATCH_ID)
    golden_ts = timeseries_df[timeseries_df['batch_id'] == GOLDEN_BATCH_ID]
    golden_window = golden_ts[golden_ts['elapsed_minutes'].between(golden_min_t, golden_max_t)]
    golden_duration = int(batches_df.loc[GOLDEN_BATCH_ID, 'batch_duration_minutes'])

    records = []
    for batch_id in sorted(batches_df.index):
        duration = int(batches_df.loc[batch_id, 'batch_duration_minutes'])
        severity = ground_truth_severity(batches_df, batch_id)
        min_t, max_t = valid_time_range(batches_df, batch_id)

        batch_ts = timeseries_df[timeseries_df['batch_id'] == batch_id]
        window = batch_ts[batch_ts['elapsed_minutes'].between(min_t, max_t)]

        stability = compute_stability(window, parameter_limits)
        process_stability_pct = sum(stability.values()) / len(stability)

        similarity = compute_similarity(window, golden_window, parameter_limits)
        golden_batch_similarity_pct = sum(similarity.values()) / len(similarity)

        fault_onset = find_fault_onset(window, parameter_limits)

        cycle_time_hrs = duration / 60.0

        oee_availability_pct = min(100.0, 100.0 * golden_duration / duration)

        perf_lo, perf_hi = OEE_PERFORMANCE_RANGES[severity]
        oee_performance_pct = seeded_range(f'{batch_id}_oee_performance', perf_lo, perf_hi)

        oee_quality_pct = min(99.5, max(85.0, (
            90.0 + 0.1 * process_stability_pct + seeded_gaussian(f'{batch_id}_oee_quality', 0, OEE_QUALITY_NOISE_STD)
        )))

        oee_pct = (oee_availability_pct * oee_performance_pct * oee_quality_pct) / 10000.0

        yield_lo, yield_hi = YIELD_RANGES[severity]
        yield_pct = seeded_range(f'{batch_id}_yield', yield_lo, yield_hi)

        qs_lo, qs_hi = QUALITY_SCORE_RANGES[severity]
        quality_score_pct = seeded_range(f'{batch_id}_quality_score', qs_lo, qs_hi)

        energy_noise = seeded_gaussian(f'{batch_id}_energy', 0, ENERGY_NOISE_STD_KWH)
        total_energy_kwh = BASE_ENERGY_KWH + ENERGY_PER_MINUTE_KWH * duration + energy_noise
        output_kg = NOMINAL_BATCH_SIZE_KG * yield_pct / 100.0
        sec_kwh_per_kg = total_energy_kwh / output_kg

        records.append({
            'batch_id': batch_id,
            'cycle_time_hrs': round(cycle_time_hrs, 3),
            'process_stability_pct': round(process_stability_pct, 2),
            'process_stability_in_control_pct_temperature': round(stability['temperature'], 2),
            'process_stability_in_control_pct_process_pressure': round(stability['process_pressure'], 2),
            'process_stability_in_control_pct_flow_rate': round(stability['flow_rate'], 2),
            'golden_batch_similarity_pct': round(golden_batch_similarity_pct, 2),
            'golden_batch_similarity_pct_temperature': round(similarity['temperature'], 2),
            'golden_batch_similarity_pct_process_pressure': round(similarity['process_pressure'], 2),
            'golden_batch_similarity_pct_flow_rate': round(similarity['flow_rate'], 2),
            'fault_onset_elapsed_minutes': fault_onset,
            'yield_pct': round(yield_pct, 2),
            'quality_score_pct': round(quality_score_pct, 2),
            'oee_availability_pct': round(oee_availability_pct, 2),
            'oee_performance_pct': round(oee_performance_pct, 2),
            'oee_quality_pct': round(oee_quality_pct, 2),
            'oee_pct': round(oee_pct, 2),
            'total_energy_kwh': round(total_energy_kwh, 2),
            'sec_kwh_per_kg': round(sec_kwh_per_kg, 4),
            'generation_method_version': GENERATION_METHOD_VERSION,
        })

    out_df = pd.DataFrame.from_records(records)
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    out_df.to_csv(OUT_CSV, index=False)
    print(f'Wrote {len(out_df)} rows to {OUT_CSV}')

    manifest = {
        'generation_method_version': GENERATION_METHOD_VERSION,
        'row_grain': 'one row per batch - completed-batch summary, not a time series',
        'source_files': [
            'data/paracetamol_batches.csv',
            'data/paracetamol_batch_timeseries.csv',
            'data/paracetamol_parameter_config.csv',
        ],
        'columns': {
            'batch_id': {'provenance': 'real', 'has_temporal_signal': False, 'note': 'PK / FK -> batches'},
            'cycle_time_hrs': {'provenance': 'real', 'has_temporal_signal': False},
            'process_stability_pct': {
                'provenance': 'derived', 'has_temporal_signal': True,
                'note': 'mean of the three in_control_pct columns below, computed over valid_time_range',
            },
            'process_stability_in_control_pct_temperature': {'provenance': 'derived', 'has_temporal_signal': True},
            'process_stability_in_control_pct_process_pressure': {'provenance': 'derived', 'has_temporal_signal': True},
            'process_stability_in_control_pct_flow_rate': {'provenance': 'derived', 'has_temporal_signal': True},
            'golden_batch_similarity_pct': {
                'provenance': 'derived', 'has_temporal_signal': True,
                'note': 'mean of the three per-parameter similarity columns below, vs PAR-GOLDEN over the shared valid_time_range window',
            },
            'golden_batch_similarity_pct_temperature': {'provenance': 'derived', 'has_temporal_signal': True},
            'golden_batch_similarity_pct_process_pressure': {'provenance': 'derived', 'has_temporal_signal': True},
            'golden_batch_similarity_pct_flow_rate': {'provenance': 'derived', 'has_temporal_signal': True},
            'fault_onset_elapsed_minutes': {
                'provenance': 'derived', 'has_temporal_signal': True,
                'note': 'first elapsed_minutes within valid_time_range where any of the 3 drying parameters left its band; NaN if none (Normal batches, or a fault that never crossed the band)',
            },
            'yield_pct': {'provenance': 'synthetic', 'has_temporal_signal': False, 'note': 'severity-tiered, seeded-hash, batch-level constant - no within-batch trajectory to predict from'},
            'quality_score_pct': {'provenance': 'synthetic', 'has_temporal_signal': False, 'note': 'temporary placeholder pending real batch_cqa_results (Quality Workbench Tier 3)'},
            'oee_availability_pct': {'provenance': 'derived_proxy', 'has_temporal_signal': False, 'note': 'uses FINAL batch_duration_minutes - not valid as a mid-batch prediction target without reformulation'},
            'oee_performance_pct': {'provenance': 'synthetic', 'has_temporal_signal': False},
            'oee_quality_pct': {'provenance': 'semi_derived', 'has_temporal_signal': False, 'note': 'function of real process_stability_pct + seeded noise, but computed once at the end'},
            'oee_pct': {'provenance': 'formula', 'has_temporal_signal': False, 'note': 'availability * performance * quality / 10000'},
            'total_energy_kwh': {'provenance': 'semi_derived', 'has_temporal_signal': False, 'note': 'uses FINAL batch_duration_minutes - same caveat as oee_availability_pct'},
            'sec_kwh_per_kg': {'provenance': 'semi_derived', 'has_temporal_signal': False, 'note': 'total_energy_kwh / output_kg, output_kg derived from synthetic yield_pct'},
            'generation_method_version': {'provenance': 'metadata', 'has_temporal_signal': False},
        },
        'prediction_readiness_note': (
            'This dataset is an end-of-batch summary only - no forecasting labels or rolling/'
            'cumulative KPI trajectories are built here. Columns marked has_temporal_signal=true '
            'are the ones a future KPI-deterioration-prediction effort could plausibly reshape into '
            'a time series (their per-parameter sub-components are stored here specifically to avoid '
            'recomputation later); columns marked false are either batch-level constants with no '
            'within-batch trajectory (synthetic fields) or derived from a value (final duration) that '
            'is only known once the batch has already finished. See '
            'docs/batch-kpis-prediction-readiness-review.md for the full analysis.'
        ),
    }
    OUT_MANIFEST.write_text(json.dumps(manifest, indent=2))
    print(f'Wrote manifest to {OUT_MANIFEST}')


if __name__ == '__main__':
    main()
