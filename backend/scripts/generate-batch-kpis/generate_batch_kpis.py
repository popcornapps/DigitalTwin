"""Generates data/paracetamol_batch_kpis.csv - one row per batch of completed-batch
KPI outcomes (Yield, OEE, Quality Score, Process Stability, Energy/SEC, Golden Batch
Similarity, Cycle Time), per docs/batch-kpis-design.md.

This is a retrospective/historical-reporting dataset, not a prediction dataset: every
field here is a single end-of-batch value. Per-parameter intermediate components and a
provenance manifest are stored alongside it specifically so a future KPI-prediction
effort (see docs/batch-kpis-prediction-readiness-review.md) doesn't have to regenerate
this data - but no forecasting labels or models are built here.

Also back-fills theoretical_output_kg/actual_output_kg/energy_kwh/assay_pct onto
data/paracetamol_batches.csv itself: real per-batch outcome facts, each driven by the
real process_stability_pct computed below rather than an independent random draw, per
the chain Process Parameters -> Process Stability -> Yield/Energy/Assay -> OEE. Yield,
Quality Score, Energy/SEC, and OEE's Quality sub-component are all recomputed from those
facts instead of severity-tiered seeded draws.

Imports app.config directly (not app.state.AppState) to reuse the exact
DRYING_WINDOW_*/valid_time_range constants the live API uses, without paying the cost
of loading the ~400MB trained model, which this script never needs.
"""
import csv
import hashlib
import json
import math
import sys
from pathlib import Path

import pandas as pd

BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT))

from app import config  # noqa: E402

OUT_CSV = config.BATCH_KPIS_CSV
OUT_MANIFEST = config.BATCH_KPIS_MANIFEST_PATH

GENERATION_METHOD_VERSION = 'v2'
GOLDEN_BATCH_ID = 'PAR-GOLDEN'
BASE_ENERGY_KWH = 180.0
ENERGY_PER_MINUTE_KWH = 0.16
ENERGY_NOISE_STD_KWH = 3.0

# (Normal, Warning, Critical) severity-tiered range - still the only synthetic
# OEE input left; nothing in the simulator models equipment throughput/speed,
# so there's no real signal to derive Performance from yet (see
# docs/batch-kpis-prediction-readiness-review.md).
OEE_PERFORMANCE_RANGES = {'Normal': (90, 98), 'Warning': (82, 92), 'Critical': (75, 88)}

# Theoretical output is a recipe constant, not derived from anything - stored
# per-product (not a bare code constant) so a future multi-product dataset can
# vary it per row without a schema change. Single product today.
THEORETICAL_OUTPUT_KG_BY_PRODUCT = {'Paracetamol 500mg': 150.0}

# Yield/Energy/Assay are now all driven by the same real signal
# (process_stability_pct, i.e. how well Temperature/Pressure/Flow held their
# steady-state band) instead of three independent severity-tiered random
# draws - see docs/batch-kpis-design.md's revision for the reasoning:
# Process Parameters -> Process Stability -> Yield/Energy/Assay -> OEE.
YIELD_LOSS_COEFF = 0.35          # fraction of theoretical output lost per unit of instability
YIELD_LOSS_NOISE_STD = 0.01      # small batch-to-batch noise, secondary to the stability term
YIELD_FRACTION_FLOOR = 0.85      # a released (non-scrapped) batch never loses more than this
ENERGY_INSTABILITY_COEFF = 0.5   # a fully-unstable batch burns up to 50% more energy per minute
ASSAY_STABILITY_COEFF = 2.0      # how many band-half-widths of assay drift per unit of instability
ASSAY_NOISE_STD = 0.3
ASSAY_FLOOR_PCT = 90.0
ASSAY_CEILING_PCT = 101.0
# Quality Score/OEE-Quality decay is normalized against 2x the spec half-width
# (10, not 5) - normalizing by the raw band width made the score hit a hard 0
# floor for any batch whose assay drifted just past the spec edge, which isn't
# how a real quality score degrades. Confirmed against the actual dataset:
# dividing by 5 zeroed out the two worst Critical batches outright; dividing
# by 10 gives a smooth, still-clearly-penalized decay instead.
QUALITY_SCORE_NORMALIZATION_SPAN = 10.0


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


def load_assay_spec() -> tuple[float, float, float]:
    """Returns (target, lower_limit, upper_limit) for the Assay row added to
    parameter_config.csv - read from the same file rather than re-hardcoded,
    so there's exactly one place the 100% / 95-105% spec is defined."""
    param_config = pd.read_csv(config.PARAMETER_CONFIG_CSV).set_index('parameter')
    row = param_config.loc['Assay']
    return float(row['golden_target']), float(row['lower_limit']), float(row['upper_limit'])


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


def clamp(lo: float, hi: float, x: float) -> float:
    return max(lo, min(hi, x))


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
    assay_target, _assay_lower, assay_upper = load_assay_spec()

    golden_min_t, golden_max_t = valid_time_range(batches_df, GOLDEN_BATCH_ID)
    golden_ts = timeseries_df[timeseries_df['batch_id'] == GOLDEN_BATCH_ID]
    golden_window = golden_ts[golden_ts['elapsed_minutes'].between(golden_min_t, golden_max_t)]
    golden_duration = int(batches_df.loc[GOLDEN_BATCH_ID, 'batch_duration_minutes'])

    records = []
    batch_output_records = []
    for batch_id in sorted(batches_df.index):
        duration = int(batches_df.loc[batch_id, 'batch_duration_minutes'])
        severity = ground_truth_severity(batches_df, batch_id)
        min_t, max_t = valid_time_range(batches_df, batch_id)

        batch_ts = timeseries_df[timeseries_df['batch_id'] == batch_id]
        window = batch_ts[batch_ts['elapsed_minutes'].between(min_t, max_t)]

        stability = compute_stability(window, parameter_limits)
        process_stability_pct = sum(stability.values()) / len(stability)
        stability_frac = process_stability_pct / 100.0

        similarity = compute_similarity(window, golden_window, parameter_limits)
        golden_batch_similarity_pct = sum(similarity.values()) / len(similarity)

        fault_onset = find_fault_onset(window, parameter_limits)

        cycle_time_hrs = duration / 60.0

        # --- Process Parameters -> Process Stability -> Yield/Energy/Assay ---
        # Single product today; stored per-product (not a bare constant) so a
        # future multi-product dataset can vary it per row without a schema change.
        theoretical_output_kg = THEORETICAL_OUTPUT_KG_BY_PRODUCT['Paracetamol 500mg']

        yield_loss_frac = YIELD_LOSS_COEFF * (1 - stability_frac)
        yield_fraction = clamp(YIELD_FRACTION_FLOOR, 1.0, (
            1.0 - yield_loss_frac + seeded_gaussian(f'{batch_id}_yield_fraction', 0, YIELD_LOSS_NOISE_STD)
        ))
        actual_output_kg = theoretical_output_kg * yield_fraction
        yield_pct = 100.0 * actual_output_kg / theoretical_output_kg

        instability_penalty = ENERGY_INSTABILITY_COEFF * (1 - stability_frac)
        energy_kwh = (
            BASE_ENERGY_KWH + ENERGY_PER_MINUTE_KWH * duration * (1 + instability_penalty)
            + seeded_gaussian(f'{batch_id}_energy', 0, ENERGY_NOISE_STD_KWH)
        )
        sec_kwh_per_kg = energy_kwh / actual_output_kg

        assay_deviation = ASSAY_STABILITY_COEFF * (1 - stability_frac) * (assay_upper - assay_target)
        assay_pct = clamp(ASSAY_FLOOR_PCT, ASSAY_CEILING_PCT, (
            assay_target - assay_deviation + seeded_gaussian(f'{batch_id}_assay', 0, ASSAY_NOISE_STD)
        ))
        # Normalized by 2x the spec half-width - see QUALITY_SCORE_NORMALIZATION_SPAN comment above.
        quality_score_pct = 100.0 * (1 - min(1.0, abs(assay_pct - assay_target) / QUALITY_SCORE_NORMALIZATION_SPAN))

        # --- OEE: Availability real (unchanged), Performance still the one
        # synthetic input left (no throughput/speed data exists to derive it
        # from), Quality now shares the same real assay-derived value as the
        # standalone Quality Score above instead of its own noise-based proxy. ---
        oee_availability_pct = min(100.0, 100.0 * golden_duration / duration)

        perf_lo, perf_hi = OEE_PERFORMANCE_RANGES[severity]
        oee_performance_pct = seeded_range(f'{batch_id}_oee_performance', perf_lo, perf_hi)

        oee_quality_pct = quality_score_pct

        oee_pct = (oee_availability_pct * oee_performance_pct * oee_quality_pct) / 10000.0

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
            'theoretical_output_kg': round(theoretical_output_kg, 2),
            'actual_output_kg': round(actual_output_kg, 2),
            'assay_pct': round(assay_pct, 2),
            'yield_pct': round(yield_pct, 2),
            'quality_score_pct': round(quality_score_pct, 2),
            'oee_availability_pct': round(oee_availability_pct, 2),
            'oee_performance_pct': round(oee_performance_pct, 2),
            'oee_quality_pct': round(oee_quality_pct, 2),
            'oee_pct': round(oee_pct, 2),
            'total_energy_kwh': round(energy_kwh, 2),
            'sec_kwh_per_kg': round(sec_kwh_per_kg, 4),
            'generation_method_version': GENERATION_METHOD_VERSION,
        })

        batch_output_records.append({
            'batch_id': batch_id,
            'theoretical_output_kg': round(theoretical_output_kg, 2),
            'actual_output_kg': round(actual_output_kg, 2),
            'energy_kwh': round(energy_kwh, 2),
            'assay_pct': round(assay_pct, 2),
        })

    out_df = pd.DataFrame.from_records(records)
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    out_df.to_csv(OUT_CSV, index=False)
    print(f'Wrote {len(out_df)} rows to {OUT_CSV}')

    # Merge the 4 new outcome fields into batches.csv itself: real per-batch facts
    # (all derived from the real process_stability_pct computed above), the same
    # grain and role as batch_duration_minutes/deviation_severity already there -
    # not KPI arithmetic, that stays in batch_kpis.csv above.
    #
    # Deliberately NOT a pandas read/reassign/to_csv round-trip: that silently
    # reserializes is_golden_batch as Python's True/False instead of the lowercase
    # true/false already on disk, and turns the literal text "None" into a blank
    # cell - scripts/build-training-dataset/buildFeatures.ts:17 does a strict
    # `b.is_golden_batch === 'true'` string comparison, so that round-trip would
    # have silently broken the existing ML training pipeline. Appending onto the
    # raw CSV rows instead leaves every existing column byte-for-byte untouched.
    new_cols = ['theoretical_output_kg', 'actual_output_kg', 'energy_kwh', 'assay_pct']
    new_values_by_batch = {r['batch_id']: r for r in batch_output_records}
    with open(config.BATCHES_CSV, newline='') as f:
        reader = csv.reader(f)
        header = next(reader)
        rows = list(reader)
    batch_id_idx = header.index('batch_id')
    with open(config.BATCHES_CSV, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(header + new_cols)
        for row in rows:
            extra = new_values_by_batch[row[batch_id_idx]]
            writer.writerow(row + [extra[col] for col in new_cols])
    print(f'Updated {config.BATCHES_CSV} with theoretical_output_kg/actual_output_kg/energy_kwh/assay_pct')

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
            'theoretical_output_kg': {'provenance': 'recipe_constant', 'has_temporal_signal': False, 'note': 'per-product constant, not derived; single product today'},
            'actual_output_kg': {'provenance': 'derived', 'has_temporal_signal': False, 'note': 'theoretical_output_kg * yield_fraction, yield_fraction driven by real process_stability_pct + small seeded noise'},
            'assay_pct': {'provenance': 'derived', 'has_temporal_signal': False, 'note': 'target(100) minus a penalty driven by real process_stability_pct + small seeded noise, checked against the Assay row in parameter_config.csv'},
            'yield_pct': {'provenance': 'derived', 'has_temporal_signal': False, 'note': '100 * actual_output_kg / theoretical_output_kg - no longer a severity-tiered random draw'},
            'quality_score_pct': {'provenance': 'derived', 'has_temporal_signal': False, 'note': 'distance of assay_pct from target, normalized by 2x the Assay spec half-width - no longer a severity-tiered random draw, but still a proxy pending real CQA lab data (Quality Workbench Tier 3)'},
            'oee_availability_pct': {'provenance': 'derived_proxy', 'has_temporal_signal': False, 'note': 'uses FINAL batch_duration_minutes - not valid as a mid-batch prediction target without reformulation'},
            'oee_performance_pct': {'provenance': 'synthetic', 'has_temporal_signal': False, 'note': 'still the one synthetic OEE input - no equipment throughput/speed data exists to derive it from'},
            'oee_quality_pct': {'provenance': 'derived', 'has_temporal_signal': False, 'note': 'now the same real assay-derived value as quality_score_pct, not an independent process_stability + noise regression'},
            'oee_pct': {'provenance': 'formula', 'has_temporal_signal': False, 'note': 'availability * performance * quality / 10000'},
            'total_energy_kwh': {'provenance': 'derived', 'has_temporal_signal': False, 'note': 'uses FINAL batch_duration_minutes AND real process_stability_pct (instability penalty) - not valid as a mid-batch prediction target without reformulation'},
            'sec_kwh_per_kg': {'provenance': 'derived', 'has_temporal_signal': False, 'note': 'total_energy_kwh / actual_output_kg - both now real/derived, no longer dependent on synthetic yield_pct'},
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
