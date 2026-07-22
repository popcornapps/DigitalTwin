import pandas as pd

from app.schemas.batch import BatchSummary, ValidTimeRange
from app.schemas.timeline import TimelinePoint, TimelineResponse
from app.state import AppState


def _ground_truth_scenario(state: AppState, batch_id: str) -> str:
    scenario = state.batches_df.loc[batch_id, 'deviation_scenario']
    # Same pandas gotcha as deviation_severity: the literal CSV text "None"
    # (used for Normal/golden batches) is parsed as a missing value, not the
    # string "None" - so it must be checked with pd.isna(), not `== 'None'`.
    return 'None' if pd.isna(scenario) else scenario


def get_batch_list(state: AppState) -> list[BatchSummary]:
    summaries = []
    for batch_id in sorted(state.test_batch_ids):
        row = state.batches_df.loc[batch_id]
        min_t, max_t = state.valid_time_range(batch_id)
        summaries.append(BatchSummary(
            batch_id=batch_id,
            plant=row['plant'],
            product='Paracetamol 500mg',
            ground_truth_scenario=_ground_truth_scenario(state, batch_id),
            ground_truth_severity=state.ground_truth_severity(batch_id),
            batch_duration_minutes=int(row['batch_duration_minutes']),
            valid_time_range=ValidTimeRange(min_elapsed_minutes=min_t, max_elapsed_minutes=max_t),
        ))
    return summaries


def get_timeline(state: AppState, batch_id: str) -> TimelineResponse | None:
    if batch_id not in state.test_batch_ids:
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
