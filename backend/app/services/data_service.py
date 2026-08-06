import json
from datetime import date

import pandas as pd

from app import config
from app.schemas.batch import BatchSummary, ValidTimeRange
from app.schemas.batch_kpis import BatchKPIs, PlantKpiRollup, PlantPeriodKpi, PlantPeriodKpiList
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
    # Recent-to-old by batch_start_datetime, not alphabetical by batch_id -
    # ISO-formatted strings (see AppState.load()) sort correctly as text, so
    # no datetime parsing is needed here.
    sorted_ids = sorted(batch_ids, key=lambda bid: state.batches_df.loc[bid, 'batch_start_datetime'], reverse=True)
    return [_build_batch_summary(state, batch_id) for batch_id in sorted_ids]


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
            inlet_air_humidity=float(r.inlet_air_humidity),
            exhaust_air_temp=float(r.exhaust_air_temp),
            filter_differential_pressure=float(r.filter_differential_pressure),
            shaker_vibration_frequency=float(r.shaker_vibration_frequency),
            product_bed_temp=float(r.product_bed_temp),
            chamber_differential_pressure=float(r.chamber_differential_pressure),
            ahu_damper_position=float(r.ahu_damper_position),
            compressed_air_pressure=float(r.compressed_air_pressure),
        )
        for r in rows.itertuples()
    ]
    return TimelineResponse(batch_id=batch_id, batch_duration_minutes=duration, points=points)


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
        theoretical_output_kg=float(row['theoretical_output_kg']),
        actual_output_kg=float(row['actual_output_kg']),
        assay_pct=float(row['assay_pct']),
        yield_pct=float(row['yield_pct']),
        quality_score_pct=float(row['quality_score_pct']),
        oee_availability_pct=float(row['oee_availability_pct']),
        oee_performance_pct=float(row['oee_performance_pct']),
        oee_quality_pct=float(row['oee_quality_pct']),
        oee_pct=float(row['oee_pct']),
        total_energy_kwh=float(row['total_energy_kwh']),
        sec_kwh_per_kg=float(row['sec_kwh_per_kg']),
        generation_method_version=str(row['generation_method_version']),
        predicted_yield_pct=None if pd.isna(row['predicted_yield_pct']) else float(row['predicted_yield_pct']),
        predicted_quality_score_pct=(
            None if pd.isna(row['predicted_quality_score_pct']) else float(row['predicted_quality_score_pct'])
        ),
        predicted_sec_kwh_per_kg=(
            None if pd.isna(row['predicted_sec_kwh_per_kg']) else float(row['predicted_sec_kwh_per_kg'])
        ),
        predicted_oee_pct=None if pd.isna(row['predicted_oee_pct']) else float(row['predicted_oee_pct']),
        predicted_total_energy_kwh=(
            None if pd.isna(row['predicted_total_energy_kwh']) else float(row['predicted_total_energy_kwh'])
        ),
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
    # Real primitive fact, summed straight from batches_df - not derived from
    # batch_kpis.total_energy_kwh (a duplicate of the same underlying value).
    plant_batches = state.batches_df.loc[plant_batch_ids]
    total_energy_consumption_kwh = round(float(plant_batches['energy_kwh'].sum()), 2)
    return PlantKpiRollup(
        plant=plant,
        batch_count=int(len(matching)),
        oee_pct=round(oee_pct, 2),
        quality_score_pct=round(quality_score_pct, 2),
        process_stability_pct=round(process_stability_pct, 2),
        plant_performance_pct=round((oee_pct + quality_score_pct + process_stability_pct) / 3, 2),
        total_energy_consumption_kwh=total_energy_consumption_kwh,
    )


def get_plant_period_kpis(
    state: AppState,
    plant: str,
    group_by: str,
    start_date: date | None = None,
    end_date: date | None = None,
) -> PlantPeriodKpiList | None:
    # Plant-manager shift/day/month rollup of Energy Consumption and Total
    # Production - reads batches_df directly (energy_kwh/actual_output_kg are
    # the real primitive facts), summed over historical completed batches
    # only. group_by validity is checked at the router boundary.
    plant_df = state.batches_df[state.batches_df['plant'] == plant]
    if plant_df.empty:
        return None  # unknown plant -> router raises 404

    # batch_start_datetime was overwritten to a formatted string in
    # AppState.load() to preserve exact API compatibility elsewhere - parse it
    # back to a real Timestamp here. An explicit format string (with a
    # literal 'Z', not %z) keeps this tz-naive so hour/date are used exactly
    # as displayed, with no UTC conversion - bare pd.to_datetime(...) or
    # utc=True would produce a tz-aware Timestamp that can't be compared
    # against the naive `date` objects from start_date/end_date below.
    start_ts = pd.to_datetime(plant_df['batch_start_datetime'], format='%Y-%m-%dT%H:%M:%S.000Z')
    # batch_start_datetime is UTC - shift to the plant's local time (IST)
    # before computing which shift/day/month a batch falls into, so bucketing
    # matches the plant's actual wall clock, not raw UTC hours.
    start_ts = start_ts + pd.Timedelta(minutes=config.PLANT_TIMEZONE_UTC_OFFSET_MINUTES)

    calendar_day = start_ts.dt.normalize()
    hour = start_ts.dt.hour
    is_day_shift = (hour >= config.DAY_SHIFT_START_HOUR) & (hour < config.NIGHT_SHIFT_START_HOUR)
    # Night Shift crosses midnight: the 00:00-05:59 continuation belongs to
    # the *previous* day's shift, not its own calendar day.
    shift_date = calendar_day - pd.to_timedelta((hour < config.DAY_SHIFT_START_HOUR).astype(int), unit='D')

    # Filter by the same date key each mode buckets on, so shift mode doesn't
    # leak an early-morning batch (calendar_day=Aug 4, but bucketed into
    # "2026-08-03 Night Shift") across an Aug-4-only query boundary.
    filter_key = shift_date if group_by == 'shift' else calendar_day
    mask = pd.Series(True, index=plant_df.index)
    if start_date is not None:
        mask &= filter_key >= pd.Timestamp(start_date)
    if end_date is not None:
        mask &= filter_key <= pd.Timestamp(end_date)

    energy_kwh, actual_output_kg = plant_df['energy_kwh'][mask], plant_df['actual_output_kg'][mask]
    calendar_day, hour, is_day_shift, shift_date = calendar_day[mask], hour[mask], is_day_shift[mask], shift_date[mask]

    if group_by == 'day':
        bucket_start, period_label = calendar_day, calendar_day.dt.strftime('%Y-%m-%d')
    elif group_by == 'month':
        bucket_start = start_ts[mask].dt.to_period('M').dt.to_timestamp()
        period_label = start_ts[mask].dt.strftime('%Y-%m')
    else:  # 'shift'
        shift_hour = is_day_shift.map({True: config.DAY_SHIFT_START_HOUR, False: config.NIGHT_SHIFT_START_HOUR})
        bucket_start = shift_date + pd.to_timedelta(shift_hour, unit='h')
        shift_label = is_day_shift.map({True: config.DAY_SHIFT_LABEL, False: config.NIGHT_SHIFT_LABEL})
        period_label = shift_date.dt.strftime('%Y-%m-%d') + ' ' + shift_label

    grouped = pd.DataFrame({
        'period_label': period_label,
        'bucket_start': bucket_start,
        'energy_kwh': energy_kwh,
        'actual_output_kg': actual_output_kg,
    }).groupby(['period_label', 'bucket_start'], as_index=False).agg(
        batch_count=('energy_kwh', 'size'),
        energy_consumption_kwh=('energy_kwh', 'sum'),
        total_production_kg=('actual_output_kg', 'sum'),
    ).sort_values('bucket_start')

    # Valid plant, just nothing in the requested date range -> empty list, not
    # 404 (that's reserved for "no such plant" above).
    periods = [
        PlantPeriodKpi(
            plant=plant,
            group_by=group_by,
            period_label=row.period_label,
            period_start=row.bucket_start.strftime('%Y-%m-%dT%H:%M:%S.000Z'),
            batch_count=int(row.batch_count),
            energy_consumption_kwh=round(float(row.energy_consumption_kwh), 2),
            total_production_kg=round(float(row.total_production_kg), 2),
        )
        for row in grouped.itertuples()
    ]
    return PlantPeriodKpiList(plant=plant, group_by=group_by, periods=periods)


def _current_bucket(group_by: str, now: pd.Timestamp) -> tuple[pd.Timestamp, str]:
    """Same bucketing rules as get_plant_period_kpis above, applied to a
    single timestamp ('now') instead of a full column - lets
    get_plant_current_period_kpi resolve the real current shift/day/month
    independent of whatever periods actually exist in the data."""
    calendar_day = now.normalize()
    hour = now.hour
    is_day_shift = config.DAY_SHIFT_START_HOUR <= hour < config.NIGHT_SHIFT_START_HOUR
    shift_date = calendar_day - pd.Timedelta(days=1 if hour < config.DAY_SHIFT_START_HOUR else 0)

    if group_by == 'day':
        return calendar_day, calendar_day.strftime('%Y-%m-%d')
    if group_by == 'month':
        return now.to_period('M').to_timestamp(), now.strftime('%Y-%m')
    # 'shift'
    shift_hour = config.DAY_SHIFT_START_HOUR if is_day_shift else config.NIGHT_SHIFT_START_HOUR
    bucket_start = shift_date + pd.Timedelta(hours=shift_hour)
    shift_label = config.DAY_SHIFT_LABEL if is_day_shift else config.NIGHT_SHIFT_LABEL
    return bucket_start, f"{shift_date.strftime('%Y-%m-%d')} {shift_label}"


def get_plant_current_period_kpi(state: AppState, plant: str, group_by: str) -> PlantPeriodKpi | None:
    """Resolves the REAL current shift/day/month (server clock) - not
    'whichever period happens to be latest in the data'. Returns a
    zero-valued row (not the wrong period, not a 404) if nothing has
    completed in that exact real period yet, so "Completed Today"/"Current
    Shift"/"This Month" genuinely reflect today's calendar date now that live
    batch completions carry real timestamps (app.live.history_writer)."""
    full = get_plant_period_kpis(state, plant, group_by)
    if full is None:
        return None  # unknown plant -> router raises 404

    # Same UTC -> plant-local (IST) shift applied to batch_start_datetime in
    # get_plant_period_kpis above - must match exactly, or "now" and the
    # historical buckets it's compared against would be in different clocks.
    now = pd.Timestamp.now(tz='UTC').tz_localize(None) + pd.Timedelta(minutes=config.PLANT_TIMEZONE_UTC_OFFSET_MINUTES)
    bucket_start, period_label = _current_bucket(group_by, now)
    bucket_start_str = bucket_start.strftime('%Y-%m-%dT%H:%M:%S.000Z')
    for period in full.periods:
        if period.period_start == bucket_start_str:
            return period

    return PlantPeriodKpi(
        plant=plant,
        group_by=group_by,
        period_label=period_label,
        period_start=bucket_start_str,
        batch_count=0,
        energy_consumption_kwh=0.0,
        total_production_kg=0.0,
    )


def get_batch_kpis_manifest() -> dict:
    return json.loads(config.BATCH_KPIS_MANIFEST_PATH.read_text())
