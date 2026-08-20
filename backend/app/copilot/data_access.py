"""The AI Copilot's ONLY window onto the rest of the system - every copilot
tool function (see app.copilot.tools) calls something in this module, never
app.live/app.services/app.state directly. Each function here wraps an
already-existing, already-storage-abstracted call (app.live.service,
app.live.alert_registry, app.services.data_service) and returns a plain
dict shaped for prompting - never a RunningBatch/DataFrame/Postgres-row
object.

This is the seam that keeps the copilot decoupled from storage: if running-
batch state ever moves off in-memory (e.g. to Redis) or the Postgres schema
changes, only the internals of the functions below need to change - the tool
schemas (app.copilot.tools), the LLM agent's prompts (app.copilot.llm_agent),
and the router all keep working unmodified, since they only ever see the
dict shapes this module hands back.
"""
from app.config import PARAMETER_LABELS, PLANT_PERIOD_GROUP_BY_VALUES
from app.live import config as live_config
from app.live import service as live_service
from app.live.alert_registry import alert_registry
from app.live.kpi_prediction_agent import KPI_LABELS
from app.live.models import RunningBatch
from app.services import data_service
from app.state import app_state

RECENT_TELEMETRY_DEFAULT_MINUTES = 10

# Which of the two severities counts as "worse," for picking the top few
# alerts per batch in get_fleet_overview - not a new judgment call, just a
# sort key for the same severities alert_registry already assigns.
_SEVERITY_RANK = {'Critical': 1, 'Warning': 0}
_KPI_STATUS_RANK = {'critical': 2, 'warning': 1, 'normal': 0}

# How many of a batch's open alerts to surface in the fleet overview - enough
# to see the leading issue(s) without ballooning token cost across every
# running batch at once. Use get_active_alerts for the full list on one batch.
FLEET_OVERVIEW_TOP_ALERTS = 2


def _batch_to_dict(batch: RunningBatch) -> dict:
    return {
        'running_batch_id': batch.running_batch_id,
        'plant': batch.plant,
        'product': batch.product,
        'status': batch.status,
        'scenario_profile': batch.scenario_profile,
        'drifting_parameter': batch.drifting_parameter,
        'phase': batch.phase,
        'elapsed_minutes': batch.elapsed_minutes,
        'target_duration_minutes': batch.target_duration_minutes,
        'history_batch_id': batch.history_batch_id,
    }


def _format_alert(a) -> dict:
    return {
        'alert_id': a.alert_id,
        'parameter': a.parameter,
        'parameter_label': PARAMETER_LABELS.get(a.parameter) or KPI_LABELS.get(a.parameter, a.parameter),
        'severity': a.severity,
        'trigger_type': a.trigger_type,
        'observation': a.observation,
        'likely_root_cause': a.likely_root_cause,
        'recommended_action': a.recommended_action,
        'urgency': a.urgency,
        'operational_impact': a.operational_impact,
        'human_decision': a.human_decision,
        'source': a.source,
    }


def _condense_kpi_prediction(kpi_prediction: dict | None) -> dict | None:
    """Trims a full KPI Prediction Agent result down to just status/deviation
    per KPI for the fleet overview - the long-form summary/explanation text
    and the detailed contributing-parameter/formula breakdowns cost a lot of
    tokens and aren't needed to judge "which batch is worst" across a whole
    fleet. Use get_latest_kpi_prediction for the full detail on one batch."""
    if kpi_prediction is None:
        return None
    kpis = [{'key': k['key'], 'status': k['status'], 'deviation_pct': k['deviation_pct']} for k in kpi_prediction['kpis']]
    worst_status = max((k['status'] for k in kpis), key=lambda s: _KPI_STATUS_RANK.get(s, 0), default='normal')
    return {'worst_status': worst_status, 'kpis': kpis}


def _resolve_plant(plant: str | None) -> str | None:
    """Normalizes a plant name the model may pass loosely (e.g. "Hyderabad" -
    a plausible-sounding guess) to the exact stored value (e.g. "Hyderabad
    Plant") via case-insensitive substring match against app.live.config.
    PLANTS - every plant-filtered lookup here does an EXACT string match
    against stored data, so an inexact-but-reasonable name from the model
    would otherwise silently match nothing and read as "no batches"/"unknown
    plant" instead of what was actually meant. Returns the original string
    unresolved if nothing plausible matches, so the caller's own exact-match
    behavior still applies rather than guessing further."""
    if not plant:
        return plant
    needle = plant.strip().lower()
    for known in live_config.PLANTS:
        if needle in known.lower() or known.lower() in needle:
            return known
    return plant


def get_running_batch_status(running_batch_id: str) -> dict | None:
    batch = live_service.get_running_batch(running_batch_id)
    return None if batch is None else _batch_to_dict(batch)


def get_fleet_overview(plant: str | None = None) -> list[dict]:
    """One compact call covering every running batch's essential status, a
    condensed KPI-prediction status, and its top open alerts - the entry
    point for any broad/multi-batch question ("what's running", "which batch
    needs attention", "any critical batches"), so answering those doesn't
    require looping per-batch KPI/alert/assessment calls one batch at a time
    (each of those is its own Azure round-trip in the tool-calling loop, and
    this system deliberately keeps that loop cheap - see app.copilot.
    llm_agent's module docstring). Fetches open alerts ONCE for the whole
    fleet, not once per batch, to avoid N redundant Postgres queries.
    Deliberately excludes raw telemetry and full KPI/alert detail to stay
    cheap regardless of fleet size - use the per-batch tools below for that."""
    plant = _resolve_plant(plant)
    batches = live_service.list_running_batches()
    if plant:
        batches = [b for b in batches if b.plant == plant]

    alerts_by_batch: dict[str, list] = {}
    for a in alert_registry.list_alerts('Open'):
        alerts_by_batch.setdefault(a.running_batch_id, []).append(a)

    overview = []
    for b in batches:
        batch_alerts = sorted(
            alerts_by_batch.get(b.running_batch_id, []),
            key=lambda a: _SEVERITY_RANK.get(a.severity, -1),
            reverse=True,
        )
        overview.append({
            **_batch_to_dict(b),
            'kpi_status': _condense_kpi_prediction(b.latest_kpi_prediction),
            'open_alert_count': len(batch_alerts),
            'top_alerts': [_format_alert(a) for a in batch_alerts[:FLEET_OVERVIEW_TOP_ALERTS]],
        })
    return overview


def get_latest_kpi_prediction(running_batch_id: str) -> dict | None:
    """The KPI Prediction Agent's last full result for this batch - already
    contains that agent's LLM-generated kpi_summary/recommended_action/
    urgency per KPI (see app.live.kpi_prediction_agent.predict_kpis), which
    is the pre-computed "LLM recommendation" half of what the copilot draws
    on. None if the batch doesn't have 30+ minutes of history yet, or isn't
    a known running batch."""
    batch = live_service.get_running_batch(running_batch_id)
    if batch is None:
        return None
    return batch.latest_kpi_prediction


def get_latest_parameter_assessments(running_batch_id: str) -> list[dict] | None:
    """The Process Parameter Deviation Agent's latest per-parameter output -
    None if running_batch_id isn't known, [] if no assessment has run yet."""
    batch = live_service.get_running_batch(running_batch_id)
    if batch is None:
        return None
    return [
        {
            'key': a.key,
            'label': PARAMETER_LABELS.get(a.key, a.key),
            'current_status': a.current_status,
            'current_observation': a.current_observation,
            'predicted_status': a.predicted_status,
            'predicted_observation': a.predicted_observation,
            'time_to_breach_minutes': a.time_to_breach_minutes,
            'confidence': a.confidence,
            'likely_root_cause': a.likely_root_cause,
            'recommended_action': a.recommended_action,
            'trigger_type': a.trigger_type,
            'urgency': a.urgency,
            'operational_impact': a.operational_impact,
        }
        for a in batch.latest_assessments
    ]


def get_active_alerts(running_batch_id: str) -> list[dict]:
    """Open deviation/KPI alerts for this batch, with full detail - the AI
    Review Desk's own durable recommendations, filtered down to one batch.
    For a fleet-wide question, use get_fleet_overview instead (which already
    includes each batch's top alerts) rather than calling this once per batch."""
    alerts = alert_registry.list_alerts('Open')
    matching = [a for a in alerts if a.running_batch_id == running_batch_id]
    return [_format_alert(a) for a in matching]


def get_recent_telemetry(running_batch_id: str, minutes: int = RECENT_TELEMETRY_DEFAULT_MINUTES) -> list[dict]:
    """Trailing window of raw process-parameter readings - how much history
    to expose here (vs the full stored history) is this module's own call,
    not the caller's, so trimming/summarizing more aggressively later is a
    one-file change."""
    history = live_service.get_telemetry_history(running_batch_id)
    recent = history[-minutes:] if history else []
    return [
        {
            'elapsed_minutes': r.elapsed_minutes,
            'phase': r.phase,
            'temperature': r.temperature,
            'process_pressure': r.process_pressure,
            'flow_rate': r.flow_rate,
            'agitator_rpm': r.agitator_rpm,
            'inlet_air_humidity': r.inlet_air_humidity,
            'exhaust_air_temp': r.exhaust_air_temp,
            'filter_differential_pressure': r.filter_differential_pressure,
            'shaker_vibration_frequency': r.shaker_vibration_frequency,
            'product_bed_temp': r.product_bed_temp,
            'chamber_differential_pressure': r.chamber_differential_pressure,
            'ahu_damper_position': r.ahu_damper_position,
            'compressed_air_pressure': r.compressed_air_pressure,
        }
        for r in recent
    ]


def get_historical_batch_kpis(batch_id: str) -> dict | None:
    """Real recorded outcome for a completed/historical batch (including
    PAR-GOLDEN) - the comparison target for "how does this compare to a
    normal batch" style questions."""
    kpis = data_service.get_batch_kpis(app_state, batch_id)
    return None if kpis is None else kpis.model_dump()


def get_plant_kpi_rollup(plant: str, group_by: str | None = None, period: str | None = None) -> dict | None:
    """Plant-level KPI numbers for a plant.
    - group_by=None (default): the existing all-time rollup (OEE/Quality/Process
      Stability/Energy) - the plant-analytics half of "history of batch data".
    - group_by='shift'/'day'/'month', period=None: the CURRENT shift/day/month -
      calls data_service.get_plant_current_period_kpi, the exact function backing
      the dashboard's Current Shift/Today/This Month cards, so numbers always agree.
    - group_by='day'/'month', period='YYYY-MM-DD'/'YYYY-MM': a specific past
      day/month, looked up from data_service.get_plant_period_kpis' full period
      list by period_label (group_by='shift' has no historical lookup - always
      current)."""
    plant = _resolve_plant(plant)
    if group_by is None:
        rollup = data_service.get_plant_kpi_rollup(app_state, plant)
        return None if rollup is None else rollup.model_dump()

    if group_by not in PLANT_PERIOD_GROUP_BY_VALUES:
        raise ValueError(f"group_by must be one of {PLANT_PERIOD_GROUP_BY_VALUES}, got '{group_by}'")

    if period is None or group_by == 'shift':
        result = data_service.get_plant_current_period_kpi(app_state, plant, group_by)
    else:
        full = data_service.get_plant_period_kpis(app_state, plant, group_by)
        result = None if full is None else next((p for p in full.periods if p.period_label == period), None)
    return None if result is None else result.model_dump()
