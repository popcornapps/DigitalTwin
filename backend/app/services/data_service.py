import json

import pandas as pd

from app import config
from app.schemas.batch import BatchSummary, ValidTimeRange
from app.schemas.batch_kpis import BatchKPIs, PlantKpiRollup
from app.schemas.timeline import TimelinePoint, TimelineResponse
from app.state import AppState


def _ground_truth_scenario(state: AppState, batch_id: str) -> str:
    scenario = state.batches_df.loc[batch_id, 'deviation_scenario']
    # Same pandas gotcha as deviation_severity: the literal CSV text "None"
    # (used for Normal/golden batches) is parsed as a missing value, not the
    # string "None" - so it must be checked with pd.isna(), not `== 'None'`.
    return 'None' if pd.isna(scenario) else scenario


def _build_batch_summary(state: AppState, batch_id: str) -> BatchSummary:
    row = state.batches_df.loc[batch_id]
    min_t, max_t = state.valid_time_range(batch_id)
    return BatchSummary(
        batch_id=batch_id,
        plant=row['plant'],
        product='Paracetamol 500mg',
        ground_truth_scenario=_ground_truth_scenario(state, batch_id),
        ground_truth_severity=state.ground_truth_severity(batch_id),
        batch_duration_minutes=int(row['batch_duration_minutes']),
        batch_start_datetime=str(row['batch_start_datetime']),
        valid_time_range=ValidTimeRange(min_elapsed_minutes=min_t, max_elapsed_minutes=max_t),
    )


def get_batch_list(state: AppState, scope: str = 'test') -> list[BatchSummary]:
    # 'test' (default) preserves the existing model-evaluation-safe behavior
    # used by Deviation Prediction and Process Monitoring. 'all' is for pages
    # like Batch Explorer that need to browse the full historical record,
    # including train-split batches like the golden batch - display, not
    # evaluation, so the same widened-scope justification applies here too.
    batch_ids = state.batches_df.index if scope == 'all' else state.test_batch_ids
    return [_build_batch_summary(state, batch_id) for batch_id in sorted(batch_ids)]


def get_batch_summary(state: AppState, batch_id: str) -> BatchSummary | None:
    # Same widened scope as get_timeline: single-batch lookup for display
    # purposes (e.g. the golden batch, which lives in train, not test) isn't
    # a model-evaluation concern, so it isn't restricted to test_batch_ids.
    if batch_id not in state.batches_df.index:
        return None
    return _build_batch_summary(state, batch_id)


def get_timeline(state: AppState, batch_id: str) -> TimelineResponse | None:
    # Deliberately wider than test_batch_ids: this is read-only historical
    # display, not model evaluation, so the golden batch (assigned to train,
    # not test) must still be fetchable here for use as a reference overlay.
    # /predict and /batches correctly stay test-split-only - that restriction
    # exists to keep model evaluation honest, which doesn't apply to display.
    if batch_id not in state.batches_df.index:
        return None
    rows = state.timeseries_df[state.timeseries_df['batch_id'] == batch_id].sort_values('elapsed_minutes')
    duration = int(state.batches_df.loc[batch_id, 'batch_duration_minutes'])
    points = [
        TimelinePoint(
            elapsed_minutes=int(r.elapsed_minutes),
            temperature=float(r.temperature),
            process_pressure=float(r.process_pressure),
            flow_rate=float(r.flow_rate),
            agitator_rpm=float(r.agitator_rpm),
        )
        for r in rows.itertuples()
    ]
    return TimelineResponse(batch_id=batch_id, batch_duration_minutes=duration, points=points)


def get_feature_row(state: AppState, batch_id: str, elapsed_minutes: int) -> dict | None:
    if batch_id not in state.test_batch_ids:
        return None
    match = state.training_df[
        (state.training_df['batch_id'] == batch_id) & (state.training_df['elapsed_minutes'] == elapsed_minutes)
    ]
    if match.empty:
        return None
    return match.iloc[0].to_dict()


def _build_batch_kpis(state: AppState, batch_id: str) -> BatchKPIs:
    row = state.batch_kpis_df.loc[batch_id]
    fault_onset = row['fault_onset_elapsed_minutes']
    return BatchKPIs(
        batch_id=batch_id,
        cycle_time_hrs=float(row['cycle_time_hrs']),
        process_stability_pct=float(row['process_stability_pct']),
        process_stability_in_control_pct_temperature=float(row['process_stability_in_control_pct_temperature']),
        process_stability_in_control_pct_process_pressure=float(row['process_stability_in_control_pct_process_pressure']),
        process_stability_in_control_pct_flow_rate=float(row['process_stability_in_control_pct_flow_rate']),
        golden_batch_similarity_pct=float(row['golden_batch_similarity_pct']),
        golden_batch_similarity_pct_temperature=float(row['golden_batch_similarity_pct_temperature']),
        golden_batch_similarity_pct_process_pressure=float(row['golden_batch_similarity_pct_process_pressure']),
        golden_batch_similarity_pct_flow_rate=float(row['golden_batch_similarity_pct_flow_rate']),
        fault_onset_elapsed_minutes=None if pd.isna(fault_onset) else float(fault_onset),
        yield_pct=float(row['yield_pct']),
        quality_score_pct=float(row['quality_score_pct']),
        oee_availability_pct=float(row['oee_availability_pct']),
        oee_performance_pct=float(row['oee_performance_pct']),
        oee_quality_pct=float(row['oee_quality_pct']),
        oee_pct=float(row['oee_pct']),
        total_energy_kwh=float(row['total_energy_kwh']),
        sec_kwh_per_kg=float(row['sec_kwh_per_kg']),
        generation_method_version=str(row['generation_method_version']),
    )


def get_batch_kpis(state: AppState, batch_id: str) -> BatchKPIs | None:
    # No test/train scope restriction here, unlike /batches and /predict: batch_kpis
    # is retrospective reporting data, never a model-evaluation concern, so every
    # batch (including the golden batch) is served the same way.
    if batch_id not in state.batch_kpis_df.index:
        return None
    return _build_batch_kpis(state, batch_id)


def get_batch_kpis_list(state: AppState) -> list[BatchKPIs]:
    return [_build_batch_kpis(state, batch_id) for batch_id in sorted(state.batch_kpis_df.index)]


def get_plant_kpi_rollup(state: AppState, plant: str) -> PlantKpiRollup | None:
    # Plant Performance is deliberately NOT a stored column - it's a rollup query
    # over batch_kpis, computed here rather than duplicated in the frontend, per
    # docs/batch-kpis-design.md §4.
    plant_batch_ids = state.batches_df.index[state.batches_df['plant'] == plant]
    matching = state.batch_kpis_df.loc[state.batch_kpis_df.index.intersection(plant_batch_ids)]
    if matching.empty:
        return None
    oee_pct = float(matching['oee_pct'].mean())
    quality_score_pct = float(matching['quality_score_pct'].mean())
    process_stability_pct = float(matching['process_stability_pct'].mean())
    return PlantKpiRollup(
        plant=plant,
        batch_count=int(len(matching)),
        oee_pct=round(oee_pct, 2),
        quality_score_pct=round(quality_score_pct, 2),
        process_stability_pct=round(process_stability_pct, 2),
        plant_performance_pct=round((oee_pct + quality_score_pct + process_stability_pct) / 3, 2),
    )


def get_batch_kpis_manifest() -> dict:
    return json.loads(config.BATCH_KPIS_MANIFEST_PATH.read_text())
