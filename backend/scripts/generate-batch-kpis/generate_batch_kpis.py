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
from app.db import get_connection  # noqa: E402

OUT_CSV = config.BATCH_KPIS_CSV
OUT_MANIFEST = config.BATCH_KPIS_MANIFEST_PATH

# v3: Yield/Quality(Assay)/Energy now incorporate the 5 secondary parameters
# (Agitator RPM, Filter Differential Pressure, Shaker Vibration, Inlet Air
# Humidity, Compressed Air Pressure) - the same 8-parameter definition
# scripts/generate-synthetic-kpi-data/generate_synthetic_kpi_data.py already
# trains the ML model on and app.live.kpi_prediction_agent.py already
# explains a live prediction with. Before v3, this script's own Yield/Quality/
# Energy used only the original 3 (Temperature/Pressure/Flow), an
# inconsistency confirmed against real data: every one of the 7 real
# Agitator-fault historical batches (PAR-087..092, PAR-119) read as ~99-100%
# Yield/Stability despite being deliberately built as fault batches, because
# the v2 formula couldn't see Agitator RPM's deviation at all.
GENERATION_METHOD_VERSION = 'v3'
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

# --- Secondary-parameter coefficients - copied exactly (same numbers, same
# names in spirit) from generate_synthetic_kpi_data.py's compute_final_kpis,
# so this script's Yield/Quality/Energy use the identical 8-parameter
# definition already used to train the ML model and to explain its live
# predictions on the KPI Prediction page. The core 3-parameter terms above
# (YIELD_LOSS_COEFF, ENERGY_INSTABILITY_COEFF, ASSAY_STABILITY_COEFF) are
# unchanged - these are added on top, not a replacement for them, matching
# how generate_synthetic_kpi_data.py itself layers the two.
TEMP_ASSAY_COEFF = 0.6
PRESSURE_ASSAY_COEFF = 0.2
FLOW_ASSAY_COEFF = 0.2
AGITATOR_YIELD_COEFF = 0.15
FILTER_DP_YIELD_COEFF = 0.03
SHAKER_YIELD_COEFF = 0.02
FILTER_DP_ASSAY_COEFF = 0.03
SHAKER_ASSAY_COEFF = 0.02
HUMIDITY_ASSAY_COEFF = 0.02
FILTER_DP_ENERGY_COEFF = 0.06
HUMIDITY_ENERGY_COEFF = 0.04
COMPRESSED_AIR_ENERGY_COEFF = 0.02

# The 8 parameters that actually feed Yield/Quality/Energy's formulas below -
# deviation scores are computed for exactly these, not all 12 (the remaining
# 4 - Exhaust Air Temp/Product Bed Temp/Chamber Differential Pressure/AHU
# Damper Position - carry no weight anywhere, same reasoning
# kpi_prediction_agent.py's own module docstring documents: their baseline is
# derived FROM Temperature/Flow Rate each tick, so scoring them too would
# double-count the same root cause under a different name).
FORMULA_PARAMETER_KEYS = (
    'temperature', 'process_pressure', 'flow_rate', 'agitator_rpm',
    'filter_differential_pressure', 'shaker_vibration_frequency',
    'inlet_air_humidity', 'compressed_air_pressure',
)


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
    """Reads from Postgres's `parameters` table (same query app.state.AppState
    uses), not the on-disk parameter_config.csv - that CSV only ever had the
    original 4 process parameters + Assay, and was never updated for the 8
    parameters scripts/generate-support-parameters/ later added (whose
    limits only exist in Postgres). Iterating config.PARAMETER_CONFIG_NAMES
    (12 keys) against the 5-row CSV would raise a KeyError, which this
    function replaces with a query that actually covers all of them."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT parameter, lower_limit, upper_limit FROM parameters WHERE parameter = ANY(%s)',
            (list(config.PARAMETER_CONFIG_NAMES.values()),),
        )
        limits_by_name = {name: (float(lower), float(upper)) for name, lower, upper in cur.fetchall()}
    return {key: limits_by_name[name] for key, name in config.PARAMETER_CONFIG_NAMES.items()}


def load_support_timeseries() -> pd.DataFrame:
    """The 4 support-timeseries columns needed by the secondary-parameter
    terms in Yield/Quality/Energy below (Filter DP, Shaker Vibration, Inlet
    Humidity, Compressed Air) - generated by
    scripts/generate-support-parameters/ for the 120 historical batches +
    PAR-GOLDEN, but only ever written to Postgres, never exported to a CSV
    (see that script's own module docstring)."""
    with get_connection() as conn:
        return pd.read_sql(
            'SELECT batch_id, elapsed_minutes, '
            'inlet_air_humidity_pct AS inlet_air_humidity, '
            'filter_differential_pressure_mbar AS filter_differential_pressure, '
            'shaker_vibration_frequency_hz AS shaker_vibration_frequency, '
            'compressed_air_pressure_bar AS compressed_air_pressure '
            'FROM batch_support_timeseries',
            conn,
        )


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


def compute_deviation_scores(window: pd.DataFrame, golden_window: pd.DataFrame, parameter_limits: dict) -> dict:
    """Average-deviation score for each of FORMULA_PARAMETER_KEYS, over this
    batch's whole drying window - abs(mean residual) normalized by the
    parameter's own band half-width, clipped to 1.0. Same normalization
    style (vs golden, vs the parameter's own band) as compute_similarity
    above, generalized from the core 3 parameters to all 8.

    Deliberately NOT app.live.kpi_prediction_agent.py's live formula, which
    adds a 0.4x-residual-std term - that term is meant to catch a process
    actively destabilizing within a rolling 30-minute window. Verified
    against real data that it does not generalize to a ~140-minute full-batch
    window: Shaker Vibration Frequency and Compressed Air Pressure are
    generated with a periodic per-batch-phase-offset cycle (see
    scripts/generate-support-parameters/'s docstring), so their residual std
    over a full batch is large (~3.2-3.5 of a 5.0 half-width) for EVERY
    batch, healthy or not - it produced a near-identical inflated score for
    genuinely Normal batches and real Agitator-fault batches alike. The
    mean-only version below does not have this problem (confirmed: the same
    two batches' residual MEANS were both small, ~0.05-0.14 of the half-
    width) and is what's actually used."""
    merged = window.merge(golden_window, on='elapsed_minutes', suffixes=('', '_golden'))
    scores = {}
    for param in FORMULA_PARAMETER_KEYS:
        lower, upper = parameter_limits[param]
        half_width = (upper - lower) / 2
        if merged.empty or half_width <= 0:
            scores[param] = 0.0
            continue
        residual = merged[param] - merged[f'{param}_golden']
        deviation_score = abs(residual.mean()) / half_width
        scores[param] = min(1.0, float(deviation_score))
    return scores


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
    # Adds the 4 secondary-parameter columns needed below (Filter DP, Shaker
    # Vibration, Inlet Humidity, Compressed Air) - Postgres-only data, see
    # load_support_timeseries. Inner join: every one of this script's 120
    # batches + PAR-GOLDEN has a matching row (confirmed against Postgres -
    # scripts/generate-support-parameters/ covers exactly this dataset), so
    # this doesn't drop anything for the batches this script actually knows
    # about; it's just the safe/explicit join type rather than assuming.
    support_df = load_support_timeseries()
    timeseries_before = len(timeseries_df)
    timeseries_df = timeseries_df.merge(support_df, on=['batch_id', 'elapsed_minutes'], how='inner')
    if len(timeseries_df) != timeseries_before:
        raise RuntimeError(
            f'Support-parameter join dropped rows: {timeseries_before} -> {len(timeseries_df)}. '
            'Some batch/elapsed_minutes combination in paracetamol_batch_timeseries.csv has no '
            'matching row in Postgres batch_support_timeseries - investigate before trusting output.'
        )
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

        # Secondary-parameter deviation scores (Section 07 of the Formula
        # Reference Guide) - the same 8-parameter definition the ML model is
        # trained on and the live KPI Prediction page explains with. Yield/
        # Energy still use stability_frac (below) for their core 3-parameter
        # term, unchanged; only Quality/Assay's core term switches from
        # stability_frac to the Temperature-weighted dev[] below, matching
        # generate_synthetic_kpi_data.py's assay_relevant_dev exactly.
        dev = compute_deviation_scores(window, golden_window, parameter_limits)

        cycle_time_hrs = duration / 60.0

        # --- Process Parameters -> Process Stability -> Yield/Energy/Assay ---
        # Single product today; stored per-product (not a bare constant) so a
        # future multi-product dataset can vary it per row without a schema change.
        theoretical_output_kg = THEORETICAL_OUTPUT_KG_BY_PRODUCT['Paracetamol 500mg']

        yield_loss_frac = (
            YIELD_LOSS_COEFF * (1 - stability_frac)
            + AGITATOR_YIELD_COEFF * dev['agitator_rpm']
            + FILTER_DP_YIELD_COEFF * dev['filter_differential_pressure']
            + SHAKER_YIELD_COEFF * dev['shaker_vibration_frequency']
        )
        yield_fraction = clamp(YIELD_FRACTION_FLOOR, 1.0, (
            1.0 - yield_loss_frac + seeded_gaussian(f'{batch_id}_yield_fraction', 0, YIELD_LOSS_NOISE_STD)
        ))
        actual_output_kg = theoretical_output_kg * yield_fraction
        yield_pct = 100.0 * actual_output_kg / theoretical_output_kg

        instability_penalty = (
            ENERGY_INSTABILITY_COEFF * (1 - stability_frac)
            + FILTER_DP_ENERGY_COEFF * dev['filter_differential_pressure']
            + HUMIDITY_ENERGY_COEFF * dev['inlet_air_humidity']
            + COMPRESSED_AIR_ENERGY_COEFF * dev['compressed_air_pressure']
        )
        energy_kwh = (
            BASE_ENERGY_KWH + ENERGY_PER_MINUTE_KWH * duration * (1 + instability_penalty)
            + seeded_gaussian(f'{batch_id}_energy', 0, ENERGY_NOISE_STD_KWH)
        )
        sec_kwh_per_kg = energy_kwh / actual_output_kg

        assay_relevant_dev = (
            TEMP_ASSAY_COEFF * dev['temperature'] + PRESSURE_ASSAY_COEFF * dev['process_pressure']
            + FLOW_ASSAY_COEFF * dev['flow_rate']
            + FILTER_DP_ASSAY_COEFF * dev['filter_differential_pressure']
            + SHAKER_ASSAY_COEFF * dev['shaker_vibration_frequency']
            + HUMIDITY_ASSAY_COEFF * dev['inlet_air_humidity']
        )
        assay_deviation = ASSAY_STABILITY_COEFF * assay_relevant_dev * (assay_upper - assay_target)
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
    # Idempotent: if new_cols are already present (a previous run already
    # appended them), strip them back out first, by column position, before
    # re-appending the freshly computed values - otherwise re-running this
    # script appends a second, duplicate copy of the same 4 columns with
    # stale values sitting alongside the new ones, silently corrupting the
    # CSV (confirmed: this is exactly what happened during this fix's own
    # iteration and produced a real downstream bug - see PR discussion).
    keep_idx = [i for i, h in enumerate(header) if h not in new_cols]
    base_header = [header[i] for i in keep_idx]
    base_rows = [[row[i] for i in keep_idx] for row in rows]
    base_batch_id_idx = base_header.index('batch_id')
    with open(config.BATCHES_CSV, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(base_header + new_cols)
        for row in base_rows:
            extra = new_values_by_batch[row[base_batch_id_idx]]
            writer.writerow(row + [extra[col] for col in new_cols])
    print(f'Updated {config.BATCHES_CSV} with theoretical_output_kg/actual_output_kg/energy_kwh/assay_pct')

    manifest = {
        'generation_method_version': GENERATION_METHOD_VERSION,
        'row_grain': 'one row per batch - completed-batch summary, not a time series',
        'source_files': [
            'data/paracetamol_batches.csv',
            'data/paracetamol_batch_timeseries.csv',
            'Postgres: batch_support_timeseries (secondary parameters)',
            'Postgres: parameters (limits for all 12 parameters)',
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
            'yield_pct': {'provenance': 'derived', 'has_temporal_signal': False, 'note': '100 * actual_output_kg / theoretical_output_kg. v3: yield_loss_frac now also includes Agitator RPM/Filter DP/Shaker Vibration deviation terms, matching the 8-parameter definition generate_synthetic_kpi_data.py trains the ML model on and kpi_prediction_agent.py explains live predictions with - not just the 3-parameter stability term used through v2'},
            'quality_score_pct': {'provenance': 'derived', 'has_temporal_signal': False, 'note': 'distance of assay_pct from target, normalized by 2x the Assay spec half-width. v3: assay_pct'"'"'s deviation term is now Temperature/Pressure/Flow-weighted (60/20/20) plus Filter DP/Shaker/Humidity, matching kpi_prediction_agent.py'"'"'s assay_relevant_dev exactly - not the flat stability_frac term used through v2. Still a proxy pending real CQA lab data (Quality Workbench Tier 3)'},
            'oee_availability_pct': {'provenance': 'derived_proxy', 'has_temporal_signal': False, 'note': 'uses FINAL batch_duration_minutes - not valid as a mid-batch prediction target without reformulation'},
            'oee_performance_pct': {'provenance': 'synthetic', 'has_temporal_signal': False, 'note': 'still the one synthetic OEE input - no equipment throughput/speed data exists to derive it from'},
            'oee_quality_pct': {'provenance': 'derived', 'has_temporal_signal': False, 'note': 'now the same real assay-derived value as quality_score_pct, not an independent process_stability + noise regression'},
            'oee_pct': {'provenance': 'formula', 'has_temporal_signal': False, 'note': 'availability * performance * quality / 10000'},
            'total_energy_kwh': {'provenance': 'derived', 'has_temporal_signal': False, 'note': 'uses FINAL batch_duration_minutes AND real process_stability_pct (instability penalty). v3: instability_penalty now also includes Filter DP/Humidity/Compressed Air deviation terms, matching the 8-parameter live definition - not just the 3-parameter stability term used through v2. Not valid as a mid-batch prediction target without reformulation'},
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
