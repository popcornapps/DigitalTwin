"""Persists a naturally-Completed live batch into the historical batches/
batch_kpis Postgres tables (+ the in-memory AppState DataFrames the Plant
KPI endpoints - app.services.data_service.get_plant_period_kpis/
get_plant_kpi_rollup - read from), so shift/day/month rollups grow in real
time instead of staying frozen at the synthetic dataset's Jan-Feb 2025 dates.

Deliberately its own module, not folded into registry.py (whose own
docstring says the live subsystem stays decoupled from app.state) - this is
the one place the live and historical planes are allowed to touch for this
feature, called from app.live.scheduler (which already imports across
layers), same bridging role app.live.golden_reference already plays for
reads.

Final KPIs (yield/quality/SEC/OEE/energy) are computed the SAME real,
deterministic way scripts/generate-batch-kpis/generate_batch_kpis.py computed
them for the 120 historical batches - real Stability from the batch's own
complete telemetry, flowing through the same Yield/Energy/Assay/OEE formula
chain - not the KPI Prediction Agent's ML guess (that model is weak, test R²
only ~0.23-0.4, and was previously used as if its guess were the real
outcome). The ML model's own last-tick prediction is still captured
separately, into predicted_* columns, purely for comparison against the real
value - it no longer drives what gets recorded. The constants/functions below
are ported from generate_batch_kpis.py, kept in sync by hand (same "ported,
not imported" convention as app/live/simulator.py vs scripts/generate-dataset)
since scripts/ isn't importable from app/.

Summary only: writes to batches + batch_kpis, not batch_timeseries - a
persisted live batch won't have a Batch Explorer timeline chart yet.
Manually-Stopped batches are never persisted here at all (see scheduler.py -
this module is only ever called for batches that reach 'Completed'
naturally); their partial energy/output would misrepresent a finished
production run.
"""
import asyncio
import hashlib
import math
from datetime import datetime, timezone

import pandas as pd

from app import config
from app.db import get_connection
from app.live import config as live_config
from app.live import golden_reference
from app.live.models import RunningBatch
from app.state import AppState

GENERATION_METHOD_VERSION = 'live_completion_v2'
# Tag for the ONE demo batch per plant per calendar day that graduates to
# permanent historical data (see _is_first_completion_today below) - counted
# in Plant KPI/Batch Explorer like the original dataset, and never purged by
# the temporary-demo-batch retention policy (app.live.service.
# prune_old_demo_batches). Every other live-completed batch that same day
# keeps the regular GENERATION_METHOD_VERSION tag above (temporary, excluded
# from Plant KPI - see app.services.data_service._exclude_demo_batches).
DAILY_PERMANENT_GENERATION_VERSION = 'live_completion_v2_daily'

ASSAY_FLOOR_PCT = 90.0
ASSAY_CEILING_PCT = 101.0
QUALITY_SCORE_NORMALIZATION_SPAN = 10.0

# --- Ported from generate_batch_kpis.py - see module docstring. ---
BASE_ENERGY_KWH = 180.0
ENERGY_PER_MINUTE_KWH = 0.16
ENERGY_NOISE_STD_KWH = 3.0
ENERGY_INSTABILITY_COEFF = 0.5
YIELD_LOSS_COEFF = 0.35
YIELD_LOSS_NOISE_STD = 0.01
YIELD_FRACTION_FLOOR = 0.85
ASSAY_STABILITY_COEFF = 2.0
ASSAY_NOISE_STD = 0.3
OEE_PERFORMANCE_RANGES = {'Normal': (90.0, 98.0), 'Warning': (82.0, 92.0), 'Critical': (75.0, 88.0)}


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


def _clamp(lo: float, hi: float, x: float) -> float:
    return max(lo, min(hi, x))


def _valid_time_range(target_duration_minutes: int) -> tuple[int, int]:
    # Same formula as app.state.AppState.valid_time_range/generate_batch_kpis.py's
    # own local version - neither can be reused directly, since no batches_df
    # row exists yet for a batch mid-persist.
    return (
        config.DRYING_WINDOW_START_MINUTES,
        target_duration_minutes - config.DRYING_WINDOW_END_BUFFER_MINUTES - config.HORIZON_MINUTES,
    )


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


def find_fault_onset(window: pd.DataFrame, parameter_limits: dict) -> float | None:
    ordered = window.sort_values('elapsed_minutes')
    for row in ordered.itertuples():
        for param in config.DRYING_PARAMETER_KEYS:
            lower, upper = parameter_limits[param]
            if not (lower <= getattr(row, param) <= upper):
                return float(row.elapsed_minutes)
    return None


_assay_spec_cache: tuple[float, float] | None = None  # (target, upper_limit)


def _assay_spec() -> tuple[float, float]:
    global _assay_spec_cache
    if _assay_spec_cache is None:
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT golden_target, upper_limit FROM parameters WHERE parameter = 'Assay'")
            target, upper = cur.fetchone()
            _assay_spec_cache = (float(target), float(upper))
    return _assay_spec_cache


def _next_par_id(app_state: AppState) -> str:
    """Continues the same PAR-XXX numbering the historical batches already
    use (e.g. after PAR-119, the next persisted live batch becomes PAR-120)
    - so a completed live batch blends into Batch Explorer's existing list
    instead of looking like a different naming scheme. Computed from the
    in-memory batches_df (already the single source of truth, kept in sync
    with Postgres by _append_to_app_state below), not a separate query -
    safe even if several batches complete in the same tick, since scheduler.py
    awaits persist_completed_batch for each one sequentially, not concurrently."""
    numeric_suffixes = [
        int(bid.split('-')[1])
        for bid in app_state.batches_df.index
        if bid.startswith('PAR-') and bid.split('-')[1].isdigit()
    ]
    next_num = (max(numeric_suffixes) + 1) if numeric_suffixes else 1
    return f'PAR-{next_num:03d}'


def _deviation_fields(batch: RunningBatch) -> tuple[str, str]:
    """Returns (deviation_scenario, deviation_severity) matching the literal
    'None'-text convention _ground_truth_scenario/ground_truth_severity
    (app/state.py) already expect, not real NULL - same as every historical
    Normal batch."""
    if batch.scenario_profile == 'Normal':
        return 'None', 'None'
    return f'Live_{batch.drifting_parameter}', batch.scenario_profile


def _is_first_completion_today(app_state: AppState, plant: str) -> bool:
    """True if no batch has yet been tagged DAILY_PERMANENT_GENERATION_VERSION
    for this plant on today's calendar date. Checked directly against
    app_state.batches_df/batch_kpis_df (not a separate in-memory counter) so
    this is correct even right after a server restart - batches_df is
    reloaded from Postgres at startup and kept in sync with every persist
    via _append_to_app_state, so it's always the authoritative record of
    which batch (if any) already graduated today."""
    today_str = datetime.now(timezone.utc).date().isoformat()
    df = app_state.batches_df
    todays_ids = df.index[(df['plant'] == plant) & (df['batch_start_datetime'].str[:10] == today_str)]
    if len(todays_ids) == 0:
        return True
    tags = app_state.batch_kpis_df['generation_method_version'].reindex(todays_ids)
    return not bool((tags == DAILY_PERMANENT_GENERATION_VERSION).any())


async def persist_completed_batch(batch: RunningBatch, app_state: AppState) -> bool:
    """Returns True if this batch was tagged as the day's one PERMANENT
    batch (see _is_first_completion_today), False if it was tagged as a
    regular temporary demo batch. Callers (scheduler.py) use this to set
    RunningBatch.is_daily_permanent, which exempts it from the temporary-
    demo-batch retention policy."""
    # Lazy imports - kpi_prediction_agent/service both eventually import this
    # module (service.py imports history_writer for delete_persisted_batch;
    # kpi_prediction_agent imports service.py for get_recent_readings) - a
    # module-level import here would close that loop into a real circular
    # import. By the time this function actually runs (a batch has been
    # ticking for 300+ minutes), every module is already fully loaded, so the
    # cycle only matters at import time, not here.
    from app.live.kpi_prediction_agent import predict_kpis
    from app.live.service import get_telemetry_history

    history = get_telemetry_history(batch.running_batch_id)
    if not history:
        # Shouldn't happen - telemetry exists from minute 0 - guard rather
        # than crash the tick loop.
        return

    # predict_kpis() spawns/joins its own thread pool for LLM reasoning -
    # blocking. Run it off the event loop since this function is itself now
    # awaited from the async tick loop (see scheduler.py).
    prediction = await asyncio.to_thread(predict_kpis, batch.running_batch_id, batch.elapsed_minutes, batch.plant)
    predicted_by_key = {k['key']: k['predicted_final'] for k in prediction['kpis']} if prediction else {}

    telemetry_df = pd.DataFrame([
        {
            'elapsed_minutes': r.elapsed_minutes,
            'temperature': r.temperature,
            'process_pressure': r.process_pressure,
            'flow_rate': r.flow_rate,
            'agitator_rpm': r.agitator_rpm,
        }
        for r in history
    ])

    duration = int(batch.target_duration_minutes)
    min_t, max_t = _valid_time_range(duration)
    window = telemetry_df[telemetry_df['elapsed_minutes'].between(min_t, max_t)]

    parameter_limits = {
        key: (cfg['lower_limit'], cfg['upper_limit']) for key, cfg in live_config.get_parameter_config().items()
    }

    golden_duration = int(app_state.batches_df.loc['PAR-GOLDEN', 'batch_duration_minutes'])
    golden_min_t, golden_max_t = _valid_time_range(golden_duration)
    golden_ts = golden_reference.golden_timeseries().reset_index()  # elapsed_minutes back to a column, for the merge
    golden_window = golden_ts[golden_ts['elapsed_minutes'].between(golden_min_t, golden_max_t)]

    stability = compute_stability(window, parameter_limits)
    process_stability_pct = sum(stability.values()) / len(stability)
    stability_frac = process_stability_pct / 100.0

    similarity = compute_similarity(window, golden_window, parameter_limits)
    golden_batch_similarity_pct = sum(similarity.values()) / len(similarity)

    fault_onset = find_fault_onset(window, parameter_limits)

    history_batch_id = _next_par_id(app_state)
    is_daily_permanent = _is_first_completion_today(app_state, batch.plant)
    generation_method_version = DAILY_PERMANENT_GENERATION_VERSION if is_daily_permanent else GENERATION_METHOD_VERSION
    theoretical_output_kg = float(app_state.batches_df.loc['PAR-GOLDEN', 'theoretical_output_kg'])
    assay_target, assay_upper = _assay_spec()

    yield_loss_frac = YIELD_LOSS_COEFF * (1 - stability_frac)
    yield_fraction = _clamp(YIELD_FRACTION_FLOOR, 1.0, (
        1.0 - yield_loss_frac + seeded_gaussian(f'{history_batch_id}_yield_fraction', 0, YIELD_LOSS_NOISE_STD)
    ))
    actual_output_kg = theoretical_output_kg * yield_fraction
    yield_pct = 100.0 * yield_fraction

    instability_penalty = ENERGY_INSTABILITY_COEFF * (1 - stability_frac)
    energy_kwh = (
        BASE_ENERGY_KWH + ENERGY_PER_MINUTE_KWH * duration * (1 + instability_penalty)
        + seeded_gaussian(f'{history_batch_id}_energy', 0, ENERGY_NOISE_STD_KWH)
    )
    sec_kwh_per_kg = energy_kwh / actual_output_kg

    assay_deviation = ASSAY_STABILITY_COEFF * (1 - stability_frac) * (assay_upper - assay_target)
    assay_pct = _clamp(ASSAY_FLOOR_PCT, ASSAY_CEILING_PCT, (
        assay_target - assay_deviation + seeded_gaussian(f'{history_batch_id}_assay', 0, ASSAY_NOISE_STD)
    ))
    quality_score_pct = 100.0 * (1 - min(1.0, abs(assay_pct - assay_target) / QUALITY_SCORE_NORMALIZATION_SPAN))

    oee_availability_pct = min(100.0, 100.0 * golden_duration / duration)
    perf_lo, perf_hi = OEE_PERFORMANCE_RANGES[batch.scenario_profile]
    oee_performance_pct = seeded_range(f'{history_batch_id}_oee_performance', perf_lo, perf_hi)
    oee_quality_pct = quality_score_pct
    oee_pct = (oee_availability_pct * oee_performance_pct * oee_quality_pct) / 10000.0

    deviation_scenario, deviation_severity = _deviation_fields(batch)

    batches_row = {
        'batch_id': history_batch_id,
        'plant': batch.plant,
        'is_golden_batch': False,
        'batch_start_datetime': batch.started_at,
        'batch_duration_minutes': duration,
        'deviation_scenario': deviation_scenario,
        'deviation_severity': deviation_severity,
        'theoretical_output_kg': round(theoretical_output_kg, 2),
        'actual_output_kg': round(actual_output_kg, 2),
        'energy_kwh': round(energy_kwh, 2),
        'assay_pct': round(assay_pct, 2),
    }
    kpis_row = {
        'batch_id': history_batch_id,
        'cycle_time_hrs': round(duration / 60.0, 3),
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
        'generation_method_version': generation_method_version,
        # ML KPI Prediction Agent's last-tick guess - captured purely for
        # comparison against the real values above, no longer the source of
        # them. None for any KPI missing from the prediction (shouldn't
        # happen at 300+ minutes, but predict_kpis returning None is guarded).
        'predicted_yield_pct': round(predicted_by_key['yield_pct'], 2) if 'yield_pct' in predicted_by_key else None,
        'predicted_quality_score_pct': (
            round(predicted_by_key['quality_score_pct'], 2) if 'quality_score_pct' in predicted_by_key else None
        ),
        'predicted_sec_kwh_per_kg': (
            round(predicted_by_key['sec_kwh_per_kg'], 4) if 'sec_kwh_per_kg' in predicted_by_key else None
        ),
        'predicted_oee_pct': round(predicted_by_key['oee_pct'], 2) if 'oee_pct' in predicted_by_key else None,
        'predicted_total_energy_kwh': (
            round(predicted_by_key['total_energy_kwh'], 2) if 'total_energy_kwh' in predicted_by_key else None
        ),
    }

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO batches (
                    batch_id, plant, is_golden_batch, batch_start_datetime, batch_duration_minutes,
                    deviation_scenario, deviation_severity, theoretical_output_kg, actual_output_kg,
                    energy_kwh, assay_pct
                ) VALUES (
                    %(batch_id)s, %(plant)s, %(is_golden_batch)s, %(batch_start_datetime)s, %(batch_duration_minutes)s,
                    %(deviation_scenario)s, %(deviation_severity)s, %(theoretical_output_kg)s, %(actual_output_kg)s,
                    %(energy_kwh)s, %(assay_pct)s
                )
                """,
                batches_row,
            )
            cur.execute(
                """
                INSERT INTO batch_kpis (
                    batch_id, cycle_time_hrs, process_stability_pct,
                    process_stability_in_control_pct_temperature, process_stability_in_control_pct_process_pressure,
                    process_stability_in_control_pct_flow_rate, golden_batch_similarity_pct,
                    golden_batch_similarity_pct_temperature, golden_batch_similarity_pct_process_pressure,
                    golden_batch_similarity_pct_flow_rate, fault_onset_elapsed_minutes,
                    theoretical_output_kg, actual_output_kg, assay_pct, yield_pct, quality_score_pct,
                    oee_availability_pct, oee_performance_pct, oee_quality_pct, oee_pct,
                    total_energy_kwh, sec_kwh_per_kg, generation_method_version,
                    predicted_yield_pct, predicted_quality_score_pct, predicted_sec_kwh_per_kg,
                    predicted_oee_pct, predicted_total_energy_kwh
                ) VALUES (
                    %(batch_id)s, %(cycle_time_hrs)s, %(process_stability_pct)s,
                    %(process_stability_in_control_pct_temperature)s, %(process_stability_in_control_pct_process_pressure)s,
                    %(process_stability_in_control_pct_flow_rate)s, %(golden_batch_similarity_pct)s,
                    %(golden_batch_similarity_pct_temperature)s, %(golden_batch_similarity_pct_process_pressure)s,
                    %(golden_batch_similarity_pct_flow_rate)s, %(fault_onset_elapsed_minutes)s,
                    %(theoretical_output_kg)s, %(actual_output_kg)s, %(assay_pct)s, %(yield_pct)s, %(quality_score_pct)s,
                    %(oee_availability_pct)s, %(oee_performance_pct)s, %(oee_quality_pct)s, %(oee_pct)s,
                    %(total_energy_kwh)s, %(sec_kwh_per_kg)s, %(generation_method_version)s,
                    %(predicted_yield_pct)s, %(predicted_quality_score_pct)s, %(predicted_sec_kwh_per_kg)s,
                    %(predicted_oee_pct)s, %(predicted_total_energy_kwh)s
                )
                """,
                kpis_row,
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()  # `with conn:` only commits/rolls back, doesn't close - see app/db.py

    _append_to_app_state(app_state, batches_row, kpis_row)
    batch.persisted_at = datetime.now(batch.started_at.tzinfo)
    batch.history_batch_id = history_batch_id
    return is_daily_permanent


def _append_to_app_state(app_state: AppState, batches_row: dict, kpis_row: dict) -> None:
    """Mirrors AppState.load()'s exact normalization (batch_start_datetime as
    a formatted string, not a raw Timestamp; literal 'None' text -> pd.NA) so
    every existing data_service.py reader keeps working unchanged on the new
    row."""
    new_batches_row = pd.DataFrame([{
        **batches_row,
        'batch_start_datetime': batches_row['batch_start_datetime'].strftime('%Y-%m-%dT%H:%M:%S.000Z'),
        'deviation_scenario': pd.NA if batches_row['deviation_scenario'] == 'None' else batches_row['deviation_scenario'],
        'deviation_severity': pd.NA if batches_row['deviation_severity'] == 'None' else batches_row['deviation_severity'],
    }]).set_index('batch_id')
    app_state.batches_df = pd.concat([app_state.batches_df, new_batches_row])

    new_kpis_row = pd.DataFrame([kpis_row]).set_index('batch_id')
    app_state.batch_kpis_df = pd.concat([app_state.batch_kpis_df, new_kpis_row])


def delete_persisted_batch(batch: RunningBatch, app_state: AppState) -> None:
    """No-op if this batch was never persisted (Stopped batches, or a failed
    persist attempt) - batch.history_batch_id is only set on a successful
    persist. batch_kpis cascades automatically (ON DELETE CASCADE on its FK
    to batches), so only the batches row needs an explicit DELETE."""
    if batch.history_batch_id is None:
        return
    history_batch_id = batch.history_batch_id
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('DELETE FROM batches WHERE batch_id = %s', (history_batch_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    app_state.batches_df = app_state.batches_df.drop(index=history_batch_id, errors='ignore')
    app_state.batch_kpis_df = app_state.batch_kpis_df.drop(index=history_batch_id, errors='ignore')
