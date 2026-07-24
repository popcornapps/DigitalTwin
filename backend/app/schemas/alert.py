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
    status: str  # 'Open' | 'Resolved'
    resolved_at_elapsed_minutes: int | None
    # LLM reasoning layer output (app.live.llm_agent), persisted on the alert
    # at creation/material-change time so it stays stable in the AI Review Desk.
    alert_summary: str | None = None
    trigger_explanation: str | None = None
    urgency: str | None = None
    operational_impact: str | None = None
