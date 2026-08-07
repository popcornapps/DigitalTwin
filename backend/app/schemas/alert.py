from datetime import datetime

from pydantic import BaseModel


class DeviationAlertOut(BaseModel):
    alert_id: str
    running_batch_id: str
    plant: str
    parameter: str
    parameter_label: str
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
    status: str  # 'Open' | 'Resolved' - the agent's own detection state
    resolved_at_elapsed_minutes: int | None
    resolved_at: datetime | None = None
    # LLM reasoning layer output (app.live.llm_agent), persisted on the alert
    # at creation/material-change time so it stays stable in the AI Review Desk.
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
    # The human's decision - separate from `status` (see models.DeviationAlert).
    human_decision: str | None = None  # 'Acknowledged' | 'Rejected' | None
    human_decision_at: datetime | None = None
    # Which agent produced this alert - 'process_parameter' or 'kpi_prediction'.
    source: str = 'process_parameter'
