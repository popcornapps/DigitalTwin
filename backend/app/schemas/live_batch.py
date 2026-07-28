from datetime import datetime

from pydantic import BaseModel


class RunningBatchSummary(BaseModel):
    running_batch_id: str
    plant: str
    product: str
    status: str
    scenario_profile: str
    drifting_parameter: str | None
    phase: str
    started_at: datetime
    elapsed_minutes: int
    target_duration_minutes: int


class TelemetryReadingOut(BaseModel):
    elapsed_minutes: int
    recorded_at: datetime
    phase: str
    temperature: float
    process_pressure: float
    flow_rate: float
    agitator_rpm: float


class LiveParameterPredictionOut(BaseModel):
    key: str
    predicted: float
    ci_low: float
    ci_high: float
    alert_level: str


class LivePredictionOut(BaseModel):
    horizon_minutes: int
    computed_at_elapsed_minutes: int
    parameters: list[LiveParameterPredictionOut]


class ParameterAssessmentOut(BaseModel):
    key: str
    current_status: str
    current_observation: str
    predicted_status: str | None
    predicted_observation: str | None
    time_to_breach_minutes: float | None
    confidence: str | None
    likely_root_cause: str | None
    recommended_action: str | None
    trigger_type: str | None
    # LLM reasoning layer output (app.live.llm_agent) - None until trigger_type is set.
    alert_summary: str | None = None
    trigger_explanation: str | None = None
    urgency: str | None = None
    operational_impact: str | None = None
    # Deterministic, evidence-based confidence in the diagnosis/action itself
    # (see app.live.confidence) - distinct from `confidence` above, which is
    # the ML forecast's own confidence-interval-width confidence.
    root_cause_confidence_pct: int | None = None
    root_cause_confidence_level: str | None = None
    root_cause_confidence_explanation: str | None = None
    recommendation_confidence_pct: int | None = None
    recommendation_confidence_level: str | None = None
    recommendation_confidence_explanation: str | None = None
    # Which path actually produced the reasoning text above - 'static' or
    # 'llm' (see app.live.llm_agent.generate_alert_reasoning).
    reasoning_source: str | None = None


class RunningBatchTelemetryResponse(BaseModel):
    batch: RunningBatchSummary
    points: list[TelemetryReadingOut]
    # None until 30+ minutes of history exist for this batch - no fabricated
    # placeholder forecast in that window, per the design's honesty rule.
    prediction: LivePredictionOut | None = None
    # Process Parameter Deviation Agent output - one entry per parameter,
    # empty list until there's a first reading to assess.
    assessments: list[ParameterAssessmentOut] = []


class CreateRunningBatchRequest(BaseModel):
    plant: str
    scenario_profile: str = 'Normal'
    drifting_parameter: str | None = None
