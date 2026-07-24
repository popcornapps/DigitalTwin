"""In-memory registry of DeviationAlert records - the Alert capability's
persistence layer. Synced once per tick from the Deviation Agent's
assessment output, right after deviation_agent.assess() runs. Unlike
latest_prediction/latest_assessments (overwritten every tick), an alert
persists across ticks once created - updated in place while the deviation
continues, marked 'Resolved' once it clears - which is what makes it a real,
durable inbox item rather than a transient display value.

This is also where the LLM reasoning layer (app.live.llm_agent) actually gets
invoked: only when an alert is brand new, or its "reasoning fingerprint"
(trigger type, severity, top root-cause candidate) has materially changed -
not on every tick, since re-reasoning about an unchanged situation every few
seconds would be wasteful and would make the persisted explanation flicker.
The generated reasoning is stored on the DeviationAlert AND mirrored back
onto the ParameterAssessment passed in, so the live Process Monitoring view
and the AI Review Desk always show the identical explanation for an alert.

Deliberately decoupled like registry.py/simulator.py - takes ParameterAssessment
objects as input rather than importing anything from the historical/ML plane
itself. llm_agent.py has the same property (zero historical/ML imports), so
this file still never touches app.state/app.services/the trained model.
"""
from datetime import datetime, timezone

from app.live import llm_agent
from app.live.models import DeviationAlert, ParameterAssessment, RunningBatch


class AlertRegistry:
    def __init__(self):
        self._alerts: dict[str, DeviationAlert] = {}
        self._seq = 0

    def _next_id(self) -> str:
        self._seq += 1
        return f'ALERT-{self._seq:04d}'

    def _find_open(self, batch_id: str, parameter: str) -> DeviationAlert | None:
        for alert in self._alerts.values():
            if alert.running_batch_id == batch_id and alert.parameter == parameter and alert.status == 'Open':
                return alert
        return None

    @staticmethod
    def _fingerprint(assessment: ParameterAssessment, severity: str) -> tuple:
        candidates = (assessment.llm_context or {}).get('root_cause_candidates') or []
        top_candidate = candidates[0]['scenario'] if candidates else None
        return (assessment.trigger_type, severity, top_candidate)

    @staticmethod
    def _apply_reasoning(target: DeviationAlert, assessment: ParameterAssessment, reasoning: dict, fingerprint: tuple) -> None:
        target.alert_summary = reasoning['alert_summary']
        target.trigger_explanation = reasoning['trigger_explanation']
        target.urgency = reasoning['urgency']
        target.likely_root_cause = reasoning['likely_root_cause']
        target.recommended_action = reasoning['recommended_action']
        target.operational_impact = reasoning['operational_impact']
        target.reasoning_fingerprint = fingerprint
        # Mirror onto the live assessment too, so Process Monitoring (which
        # reads batch.latest_assessments, not the alert) shows the exact same
        # explanation as the AI Review Desk for this same alert.
        assessment.alert_summary = reasoning['alert_summary']
        assessment.trigger_explanation = reasoning['trigger_explanation']
        assessment.urgency = reasoning['urgency']
        assessment.likely_root_cause = reasoning['likely_root_cause']
        assessment.recommended_action = reasoning['recommended_action']
        assessment.operational_impact = reasoning['operational_impact']

    def sync_from_assessment(self, batch: RunningBatch, assessment: ParameterAssessment) -> None:
        existing = self._find_open(batch.running_batch_id, assessment.key)
        is_deviating = assessment.trigger_type is not None

        if not is_deviating:
            if existing is not None:
                existing.status = 'Resolved'
                existing.resolved_at_elapsed_minutes = batch.elapsed_minutes
            return

        severity = (assessment.llm_context or {}).get('severity') or (
            'Critical' if 'critical' in (assessment.current_status, assessment.predicted_status or '') else 'Warning'
        )
        fingerprint = self._fingerprint(assessment, severity)

        if existing is not None:
            # Same alert - the cheap deterministic facts refresh every tick
            # regardless (time-to-breach counts down, observation text
            # updates), but the LLM-authored narrative below is only
            # regenerated if something material actually changed.
            existing.trigger_type = assessment.trigger_type
            existing.severity = severity
            existing.observation = assessment.current_observation
            existing.predicted_observation = assessment.predicted_observation
            existing.time_to_breach_minutes = assessment.time_to_breach_minutes
            existing.confidence = assessment.confidence

            if existing.reasoning_fingerprint == fingerprint:
                # No material change - keep the persisted narrative stable,
                # just mirror it back so the live view matches.
                assessment.alert_summary = existing.alert_summary
                assessment.trigger_explanation = existing.trigger_explanation
                assessment.urgency = existing.urgency
                assessment.likely_root_cause = existing.likely_root_cause
                assessment.recommended_action = existing.recommended_action
                assessment.operational_impact = existing.operational_impact
                return

            reasoning = llm_agent.generate_alert_reasoning(assessment.llm_context or {})
            self._apply_reasoning(existing, assessment, reasoning, fingerprint)
            return

        reasoning = llm_agent.generate_alert_reasoning(assessment.llm_context or {})
        alert = DeviationAlert(
            alert_id=self._next_id(),
            running_batch_id=batch.running_batch_id,
            plant=batch.plant,
            parameter=assessment.key,
            trigger_type=assessment.trigger_type,
            severity=severity,
            detected_at_elapsed_minutes=batch.elapsed_minutes,
            created_at=datetime.now(timezone.utc),
            observation=assessment.current_observation,
            predicted_observation=assessment.predicted_observation,
            time_to_breach_minutes=assessment.time_to_breach_minutes,
            confidence=assessment.confidence,
            likely_root_cause=None,
            recommended_action=None,
            status='Open',
        )
        self._apply_reasoning(alert, assessment, reasoning, fingerprint)
        self._alerts[alert.alert_id] = alert

    def list_alerts(self, status: str | None = None) -> list[DeviationAlert]:
        alerts = list(self._alerts.values())
        if status:
            alerts = [a for a in alerts if a.status == status]
        return sorted(alerts, key=lambda a: a.created_at, reverse=True)


alert_registry = AlertRegistry()
