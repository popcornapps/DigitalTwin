from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class ParameterAssessment:
    """One parameter's output from the Process Parameter Deviation Agent -
    deliberately keeps Current and Predicted as separate, clearly labeled
    fields rather than collapsing them into one status, since a parameter
    can be fine now but forecast to breach soon (or vice versa).

    Detect/Project (current_status, predicted_status, time_to_breach_minutes,
    confidence) are fully deterministic. likely_root_cause, recommended_action,
    alert_summary, trigger_explanation, urgency, and operational_impact are the
    LLM reasoning layer's output (see app.live.llm_agent) - synthesized from
    the evidence below, not selected from a template."""
    key: str
    current_status: str  # 'normal' | 'warning' | 'critical'
    current_observation: str
    predicted_status: str | None  # None if no prediction yet (< 30 min of history)
    predicted_observation: str | None
    time_to_breach_minutes: float | None
    confidence: str | None  # 'High' | 'Medium' | 'Low' - from the model's own CI width
    likely_root_cause: str | None  # None when nothing is deviating
    recommended_action: str | None
    # 'current' | 'predicted' | 'both' | None - which signal(s) actually
    # triggered concern, so the UI/alert can say which kind of deviation this is.
    trigger_type: str | None
    # --- LLM reasoning layer output (None until trigger_type is set) ---
    alert_summary: str | None = None
    trigger_explanation: str | None = None
    urgency: str | None = None  # one of live.llm_agent.URGENCY_LEVELS
    operational_impact: str | None = None
    # Deterministic, evidence-based confidence scores (see app.live.confidence)
    # - distinct from `confidence` above, which is the ML forecast's own CI-
    # width confidence. These score how much to trust the diagnosis/action
    # itself, not the forecast. None until trigger_type is set.
    root_cause_confidence_pct: int | None = None
    root_cause_confidence_level: str | None = None  # 'High' | 'Medium' | 'Low'
    root_cause_confidence_explanation: str | None = None
    recommendation_confidence_pct: int | None = None
    recommendation_confidence_level: str | None = None
    recommendation_confidence_explanation: str | None = None
    # Which path actually produced alert_summary/.../operational_impact above
    # - 'static' (deterministic template) or 'llm' (real Azure OpenAI call).
    # Set once, in app.live.llm_agent.generate_alert_reasoning, never guessed
    # here - lets the UI show which one actually ran, since both render in
    # the same shape and are otherwise indistinguishable at a glance.
    reasoning_source: str | None = None
    # Internal plumbing consumed by alert_registry.sync_from_assessment to
    # decide whether/how to call the LLM - built here where parameter labels,
    # units, and ranked historical candidates are already available. Never
    # serialized to the API.
    llm_context: dict | None = field(default=None, repr=False)


@dataclass
class LiveParameterPrediction:
    key: str
    predicted: float
    ci_low: float
    ci_high: float
    alert_level: str  # 'Normal' | 'Warning' | 'Critical' - from the unmodified classify_predicted()


@dataclass
class LivePrediction:
    horizon_minutes: int
    computed_at_elapsed_minutes: int
    # All 4 parameters, uniformly - no phase-aware exclusion of Agitator RPM
    # here, per the confirmed continuous-process design.
    parameters: list[LiveParameterPrediction]


@dataclass
class RunningBatch:
    running_batch_id: str
    plant: str
    product: str
    status: str  # 'Running' | 'Completed' | 'Stopped'
    scenario_profile: str  # 'Normal' | 'Warning' | 'Critical'
    drifting_parameter: str | None
    phase: str  # 'dispensing' | 'dry_mixing' | 'wet_massing' | 'transfer' | 'drying' | 'cooling' | 'complete'
    started_at: datetime
    elapsed_minutes: int
    target_duration_minutes: int
    # None until 30+ minutes of history exist; overwritten each tick, not a
    # history of past forecasts - only the current one matters.
    latest_prediction: LivePrediction | None = None
    # One entry per parameter, overwritten each tick - the Deviation Agent's
    # current output, same "latest only" convention as latest_prediction.
    latest_assessments: list[ParameterAssessment] = field(default_factory=list)
    # The KPI Prediction Agent's last full result (same dict shape
    # KpiPredictionResponse expects) - overwritten each tick by scheduler.py,
    # same "latest only" convention as latest_prediction/latest_assessments.
    # app.routers.kpi_prediction reads this directly instead of calling
    # kpi_prediction_agent.predict_kpis() itself, so a page view/refresh
    # never blocks on-demand waiting for a slow Agent LLM call to finish -
    # all of that work already happened in the background, on the
    # scheduler's own clock, whether or not anyone was looking. None until
    # the first tick after creation computes it (briefly, even though 30+
    # minutes of history already exist from the instant pre-fill - just
    # hasn't been processed by the scheduler yet).
    latest_kpi_prediction: dict | None = None
    # Wall-clock time this batch's completion was successfully written to
    # Postgres (app.live.history_writer), or None if never persisted (still
    # Running/Stopped, or a persist attempt failed) - a debug signal, not a
    # correctness mechanism (see history_writer.py for why double-persistence
    # can't happen regardless of this field).
    persisted_at: datetime | None = None
    # The sequential PAR-XXX id assigned at persist time (continues the same
    # numbering as the historical batches, e.g. PAR-120), or None if never
    # persisted. Unlike the old timestamp-derived id, a PAR-XXX number can't
    # be recomputed later purely from this batch's own fields (it depends on
    # whatever the highest existing PAR number was at insert time) - it must
    # be stored here so history_writer.delete_persisted_batch knows which
    # historical row to remove.
    history_batch_id: str | None = None
    # Wall-clock time this batch left 'Running' (either naturally Completed
    # or manually Stopped) - None while still Running. Unlike persisted_at
    # (which is Completed-and-successfully-persisted only), this is set for
    # BOTH terminal outcomes, so the demo-batch retention policy (keep the
    # latest N finished demo batches, purge older ones - see
    # app.live.service.prune_old_demo_batches) has one consistent timestamp
    # to sort by regardless of how a batch ended.
    terminal_at: datetime | None = None
    # True if this batch was the first to naturally complete for its plant on
    # its calendar day - history_writer.persist_completed_batch tags such a
    # batch as PERMANENT historical data (counted in Plant KPI/Batch
    # Explorer, like the original dataset) instead of temporary demo data.
    # Set once, right after a successful persist (see scheduler.py) - never
    # for Stopped batches (only naturally-Completed ones are ever persisted
    # at all - see history_writer.py's own docstring). service.
    # prune_old_demo_batches skips any batch with this set, so it's never
    # deleted by the temporary-demo-batch retention policy.
    is_daily_permanent: bool = False


@dataclass
class DeviationAlert:
    """A persistent record, unlike latest_prediction/latest_assessments -
    created once when a deviation is first detected and updated in place on
    later ticks, not overwritten/discarded. Survives until the underlying
    deviation clears (status -> 'Resolved'), which is what lets it flow into
    the AI Review Desk as a real, durable inbox item.

    likely_root_cause/recommended_action/alert_summary/trigger_explanation/
    urgency/operational_impact are the LLM reasoning layer's output, generated
    once when this alert is created or materially changes (see
    alert_registry.sync_from_assessment) and left untouched on later ticks
    where nothing material changed - so the same explanation a user sees in
    Process Monitoring is still there later in the AI Review Desk, even after
    the live numbers have moved on."""
    alert_id: str
    running_batch_id: str
    plant: str
    parameter: str
    trigger_type: str  # 'current' | 'predicted' | 'both'
    severity: str  # 'Warning' | 'Critical'
    detected_at_elapsed_minutes: int
    created_at: datetime
    observation: str
    predicted_observation: str | None
    time_to_breach_minutes: float | None
    confidence: str | None
    likely_root_cause: str | None
    recommended_action: str | None
    status: str  # 'Open' | 'Resolved' - the AGENT's own detection state (has the deviation cleared on its own)
    resolved_at_elapsed_minutes: int | None = None
    # Wall-clock time the agent marked this Resolved - distinct from
    # resolved_at_elapsed_minutes (which is relative to the batch's own
    # clock) - needed to compute real pending duration against created_at.
    resolved_at: datetime | None = None
    alert_summary: str | None = None
    trigger_explanation: str | None = None
    urgency: str | None = None
    operational_impact: str | None = None
    # Deterministic, evidence-based confidence scores (see app.live.confidence)
    # - refreshed every tick like time_to_breach_minutes/confidence above
    # (cheap local computation, not gated behind the LLM re-reasoning check).
    root_cause_confidence_pct: int | None = None
    root_cause_confidence_level: str | None = None
    root_cause_confidence_explanation: str | None = None
    recommendation_confidence_pct: int | None = None
    recommendation_confidence_level: str | None = None
    recommendation_confidence_explanation: str | None = None
    # Which path actually produced alert_summary/.../operational_impact above
    # - 'static' or 'llm' (see ParameterAssessment.reasoning_source). Updated
    # only when the reasoning itself is regenerated (new alert or material
    # change), same as those fields - not refreshed every tick.
    reasoning_source: str | None = None
    # The HUMAN's decision - deliberately separate from `status` above: an
    # operator can acknowledge an alert that's still actively deviating, and
    # the agent can resolve an alert nobody ever reviewed. Collapsing these
    # into one field would hide one or the other.
    human_decision: str | None = None  # 'Acknowledged' | 'Rejected' | None
    human_decision_at: datetime | None = None
    # Cache key for deciding whether the persisted LLM reasoning above needs
    # regenerating (new alert, severity change, or the ranked root-cause
    # candidates changed) - not serialized to the API.
    reasoning_fingerprint: tuple | None = field(default=None, repr=False)
    # Which agent produced this alert - 'process_parameter' (the Process
    # Parameter Deviation Agent, `parameter` holds one of the 4 process
    # parameter keys) or 'kpi_prediction' (the KPI Prediction Agent,
    # `parameter` reuses the same column for one of the 5 KPI keys - no
    # collision between the two key spaces).
    source: str = 'process_parameter'


@dataclass
class TelemetryReading:
    running_batch_id: str
    elapsed_minutes: int
    recorded_at: datetime
    phase: str
    temperature: float
    process_pressure: float
    flow_rate: float
    agitator_rpm: float
    inlet_air_humidity: float
    exhaust_air_temp: float
    filter_differential_pressure: float
    shaker_vibration_frequency: float
    product_bed_temp: float
    chamber_differential_pressure: float
    ahu_damper_position: float
    compressed_air_pressure: float
