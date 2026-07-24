from fastapi import APIRouter

from app.config import PARAMETER_LABELS
from app.live.alert_registry import alert_registry
from app.live.models import DeviationAlert
from app.schemas.alert import DeviationAlertOut

router = APIRouter(prefix='/api/alerts', tags=['alerts'])


def _to_out(alert: DeviationAlert) -> DeviationAlertOut:
    return DeviationAlertOut(
        alert_id=alert.alert_id,
        running_batch_id=alert.running_batch_id,
        plant=alert.plant,
        parameter=alert.parameter,
        parameter_label=PARAMETER_LABELS[alert.parameter],
        trigger_type=alert.trigger_type,
        severity=alert.severity,
        detected_at_elapsed_minutes=alert.detected_at_elapsed_minutes,
        created_at=alert.created_at,
        observation=alert.observation,
        predicted_observation=alert.predicted_observation,
        time_to_breach_minutes=alert.time_to_breach_minutes,
        confidence=alert.confidence,
        likely_root_cause=alert.likely_root_cause,
        recommended_action=alert.recommended_action,
        status=alert.status,
        resolved_at_elapsed_minutes=alert.resolved_at_elapsed_minutes,
        alert_summary=alert.alert_summary,
        trigger_explanation=alert.trigger_explanation,
        urgency=alert.urgency,
        operational_impact=alert.operational_impact,
    )


@router.get('', response_model=list[DeviationAlertOut])
def list_alerts(status: str | None = None):
    return [_to_out(a) for a in alert_registry.list_alerts(status)]
