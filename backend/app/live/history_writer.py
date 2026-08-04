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

Summary only: writes to batches + batch_kpis, not batch_timeseries - a
persisted live batch won't have a Batch Explorer timeline chart yet.
Manually-Stopped batches are never persisted here at all (see scheduler.py -
this module is only ever called for batches that reach 'Completed'
naturally); their partial energy/output would misrepresent a finished
production run.
"""
from datetime import datetime

import pandas as pd

from app.db import get_connection
from app.live.models import RunningBatch
from app.state import AppState

GENERATION_METHOD_VERSION = 'live_completion_v1'

# Midpoint of generate_batch_kpis.py's OEE_PERFORMANCE_RANGES per severity
# tier - no live throughput/speed signal exists to derive this properly (same
# gap the historical generator itself has, which uses a seeded random draw
# instead). A fixed per-tier midpoint keeps this deterministic/reproducible
# rather than introducing seeded-randomness machinery into the live path.
OEE_PERFORMANCE_MIDPOINT = {'Normal': 94.0, 'Warning': 87.0, 'Critical': 81.5}

ASSAY_FLOOR_PCT = 90.0
ASSAY_CEILING_PCT = 101.0
QUALITY_SCORE_NORMALIZATION_SPAN = 10.0  # matches generate_batch_kpis.py

_assay_target_cache: float | None = None


def _assay_target(app_state: AppState) -> float:
    global _assay_target_cache
    if _assay_target_cache is None:
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT golden_target FROM parameters WHERE parameter = 'Assay'")
            _assay_target_cache = float(cur.fetchone()[0])
    return _assay_target_cache


def history_batch_id_for(batch: RunningBatch) -> str:
    # running_batch_id alone isn't safe: its per-plant sequence counter
    # (registry._plant_seq) resets to 0 on every process restart, so
    # "RUN-HYD-001" gets reissued to a brand-new batch after a restart and
    # would collide with a prior life's already-persisted row. started_at is
    # unique per instance even across restarts.
    return f'{batch.running_batch_id}-{int(batch.started_at.timestamp())}'


def _deviation_fields(batch: RunningBatch) -> tuple[str, str]:
    """Returns (deviation_scenario, deviation_severity) matching the literal
    'None'-text convention _ground_truth_scenario/ground_truth_severity
    (app/state.py) already expect, not real NULL - same as every historical
    Normal batch."""
    if batch.scenario_profile == 'Normal':
        return 'None', 'None'
    return f'Live_{batch.drifting_parameter}', batch.scenario_profile


def _derive_assay_pct(quality_score_pct: float, target: float) -> float:
    # Inverts generate_batch_kpis.py's quality_score_pct formula:
    #   quality_score_pct = 100 * (1 - min(1, |assay_pct - target| / 10))
    # assuming the same always-below-target direction that generator uses.
    deviation = (1.0 - quality_score_pct / 100.0) * QUALITY_SCORE_NORMALIZATION_SPAN
    return max(ASSAY_FLOOR_PCT, min(ASSAY_CEILING_PCT, target - deviation))


def _severity_tier_defaults(app_state: AppState, deviation_severity: str) -> dict:
    """process_stability_pct/golden_batch_similarity_pct (+ each's 3
    per-parameter columns): no live per-minute stability/similarity
    computation exists for a live batch (would need the discarded
    TelemetryReading history) - reuses the mean of historical batch_kpis
    rows sharing the same severity tier as the best available stand-in,
    rather than inventing a flat constant."""
    severity_key = None if deviation_severity == 'None' else deviation_severity
    batches_df = app_state.batches_df
    if severity_key is None:
        tier_batch_ids = batches_df.index[batches_df['deviation_severity'].isna()]
    else:
        tier_batch_ids = batches_df.index[batches_df['deviation_severity'] == severity_key]
    tier_kpis = app_state.batch_kpis_df.loc[app_state.batch_kpis_df.index.intersection(tier_batch_ids)]
    cols = [
        'process_stability_pct',
        'process_stability_in_control_pct_temperature',
        'process_stability_in_control_pct_process_pressure',
        'process_stability_in_control_pct_flow_rate',
        'golden_batch_similarity_pct',
        'golden_batch_similarity_pct_temperature',
        'golden_batch_similarity_pct_process_pressure',
        'golden_batch_similarity_pct_flow_rate',
    ]
    means = tier_kpis[cols].mean()
    return {col: round(float(means[col]), 2) for col in cols}


def persist_completed_batch(batch: RunningBatch, app_state: AppState) -> None:
    # Lazy import - kpi_prediction_agent imports app.live.service (for
    # get_recent_readings), and service.py imports this module (for
    # delete_persisted_batch) - a module-level import here would close that
    # loop into a real circular import. By the time this function actually
    # runs (a batch has been ticking for 300+ minutes), every module is
    # already fully loaded, so the cycle only matters at import time, not here.
    from app.live.kpi_prediction_agent import predict_kpis

    prediction = predict_kpis(batch.running_batch_id, batch.elapsed_minutes, batch.plant)
    if prediction is None:
        # Batches always run 300+ minutes, well past the 30-min feature
        # window predict_kpis requires - this branch should be unreachable
        # at natural completion, but guard rather than crash the tick loop.
        return

    kpi_by_key = {k['key']: k['predicted_final'] for k in prediction['kpis']}
    history_batch_id = history_batch_id_for(batch)
    theoretical_output_kg = float(app_state.batches_df.loc['PAR-GOLDEN', 'theoretical_output_kg'])
    yield_pct = kpi_by_key['yield_pct']
    quality_score_pct = kpi_by_key['quality_score_pct']
    oee_pct = kpi_by_key['oee_pct']
    total_energy_kwh = kpi_by_key['total_energy_kwh']
    sec_kwh_per_kg = kpi_by_key['sec_kwh_per_kg']
    actual_output_kg = theoretical_output_kg * (yield_pct / 100.0)
    assay_pct = _derive_assay_pct(quality_score_pct, _assay_target(app_state))
    deviation_scenario, deviation_severity = _deviation_fields(batch)

    golden_duration = int(app_state.batches_df.loc['PAR-GOLDEN', 'batch_duration_minutes'])
    oee_availability_pct = min(100.0, 100.0 * golden_duration / batch.target_duration_minutes)
    oee_performance_pct = OEE_PERFORMANCE_MIDPOINT[batch.scenario_profile]
    oee_quality_pct = quality_score_pct
    stability_defaults = _severity_tier_defaults(app_state, deviation_severity)

    batches_row = {
        'batch_id': history_batch_id,
        'plant': batch.plant,
        'is_golden_batch': False,
        'batch_start_datetime': batch.started_at,
        'batch_duration_minutes': int(batch.target_duration_minutes),
        'deviation_scenario': deviation_scenario,
        'deviation_severity': deviation_severity,
        'theoretical_output_kg': round(theoretical_output_kg, 2),
        'actual_output_kg': round(actual_output_kg, 2),
        'energy_kwh': round(total_energy_kwh, 2),
        'assay_pct': round(assay_pct, 2),
    }
    kpis_row = {
        'batch_id': history_batch_id,
        'cycle_time_hrs': round(batch.target_duration_minutes / 60.0, 3),
        'process_stability_pct': stability_defaults['process_stability_pct'],
        'process_stability_in_control_pct_temperature': stability_defaults['process_stability_in_control_pct_temperature'],
        'process_stability_in_control_pct_process_pressure': stability_defaults['process_stability_in_control_pct_process_pressure'],
        'process_stability_in_control_pct_flow_rate': stability_defaults['process_stability_in_control_pct_flow_rate'],
        'golden_batch_similarity_pct': stability_defaults['golden_batch_similarity_pct'],
        'golden_batch_similarity_pct_temperature': stability_defaults['golden_batch_similarity_pct_temperature'],
        'golden_batch_similarity_pct_process_pressure': stability_defaults['golden_batch_similarity_pct_process_pressure'],
        'golden_batch_similarity_pct_flow_rate': stability_defaults['golden_batch_similarity_pct_flow_rate'],
        'fault_onset_elapsed_minutes': None,
        'theoretical_output_kg': round(theoretical_output_kg, 2),
        'actual_output_kg': round(actual_output_kg, 2),
        'assay_pct': round(assay_pct, 2),
        'yield_pct': round(yield_pct, 2),
        'quality_score_pct': round(quality_score_pct, 2),
        'oee_availability_pct': round(oee_availability_pct, 2),
        'oee_performance_pct': round(oee_performance_pct, 2),
        'oee_quality_pct': round(oee_quality_pct, 2),
        'oee_pct': round(oee_pct, 2),
        'total_energy_kwh': round(total_energy_kwh, 2),
        'sec_kwh_per_kg': round(sec_kwh_per_kg, 4),
        'generation_method_version': GENERATION_METHOD_VERSION,
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
                    total_energy_kwh, sec_kwh_per_kg, generation_method_version
                ) VALUES (
                    %(batch_id)s, %(cycle_time_hrs)s, %(process_stability_pct)s,
                    %(process_stability_in_control_pct_temperature)s, %(process_stability_in_control_pct_process_pressure)s,
                    %(process_stability_in_control_pct_flow_rate)s, %(golden_batch_similarity_pct)s,
                    %(golden_batch_similarity_pct_temperature)s, %(golden_batch_similarity_pct_process_pressure)s,
                    %(golden_batch_similarity_pct_flow_rate)s, %(fault_onset_elapsed_minutes)s,
                    %(theoretical_output_kg)s, %(actual_output_kg)s, %(assay_pct)s, %(yield_pct)s, %(quality_score_pct)s,
                    %(oee_availability_pct)s, %(oee_performance_pct)s, %(oee_quality_pct)s, %(oee_pct)s,
                    %(total_energy_kwh)s, %(sec_kwh_per_kg)s, %(generation_method_version)s
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
    """Safe no-op if this batch was never persisted (Stopped batches, or a
    failed persist attempt) - DELETE on a non-matching batch_id affects 0
    rows. batch_kpis cascades automatically (ON DELETE CASCADE on its FK to
    batches), so only the batches row needs an explicit DELETE."""
    history_batch_id = history_batch_id_for(batch)
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
