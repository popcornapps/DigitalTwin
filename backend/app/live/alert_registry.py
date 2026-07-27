"""Persistence layer for DeviationAlert records - the Alert capability's
storage. Synced once per tick from the Deviation Agent's assessment output,
right after deviation_agent.assess() runs. Unlike latest_prediction/
latest_assessments (overwritten every tick), an alert persists once created -
updated in place while the deviation continues, marked 'Resolved' once it
clears - which is what makes it a real, durable inbox item rather than a
transient display value.

Persisted to a JSON file on disk (app.config.LIVE_ALERTS_STORE_PATH), read
back at startup - so the AI Review Desk acts as a true recommendation
history that survives a backend restart, not just an in-memory list that
resets every time the process restarts (which happens often in dev, since
--reload restarts on every .py file change).

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
import asyncio
import json
import logging
from dataclasses import asdict
from datetime import datetime, timezone

from app.config import LIVE_ALERTS_STORE_PATH
from app.live import llm_agent
from app.live.models import DeviationAlert, ParameterAssessment, RunningBatch

logger = logging.getLogger(__name__)

_DATETIME_FIELDS = ('created_at', 'resolved_at', 'human_decision_at')


def _serialize(alert: DeviationAlert) -> dict:
    d = asdict(alert)
    for key in _DATETIME_FIELDS:
        if d[key] is not None:
            d[key] = d[key].isoformat()
    if d['reasoning_fingerprint'] is not None:
        d['reasoning_fingerprint'] = list(d['reasoning_fingerprint'])
    return d


def _deserialize(d: dict) -> DeviationAlert:
    d = dict(d)
    for key in _DATETIME_FIELDS:
        if d.get(key):
            d[key] = datetime.fromisoformat(d[key])
    if d.get('reasoning_fingerprint') is not None:
        d['reasoning_fingerprint'] = tuple(d['reasoning_fingerprint'])
    return DeviationAlert(**d)


class AlertRegistry:
    def __init__(self):
        self._alerts: dict[str, DeviationAlert] = {}
        self._seq = 0
        self._load()

    def _load(self) -> None:
        if not LIVE_ALERTS_STORE_PATH.exists():
            return
        try:
            raw = json.loads(LIVE_ALERTS_STORE_PATH.read_text())
        except Exception:
            logger.exception('Failed to read %s - starting with an empty alert history.', LIVE_ALERTS_STORE_PATH)
            return
        for item in raw:
            try:
                alert = _deserialize(item)
            except Exception:
                logger.exception('Skipping unreadable stored alert: %r', item)
                continue
            self._alerts[alert.alert_id] = alert
        if self._alerts:
            # Keep handing out fresh IDs after a restart, not colliding with
            # whatever was already persisted (ALERT-0001, ALERT-0002, ...).
            self._seq = max(int(aid.split('-')[1]) for aid in self._alerts)

    def _persist(self) -> None:
        try:
            LIVE_ALERTS_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
            payload = [_serialize(a) for a in self._alerts.values()]
            LIVE_ALERTS_STORE_PATH.write_text(json.dumps(payload, indent=2))
        except Exception:
            logger.exception('Failed to persist alert history to %s', LIVE_ALERTS_STORE_PATH)

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

    async def sync_from_assessment(self, batch: RunningBatch, assessment: ParameterAssessment) -> None:
        existing = self._find_open(batch.running_batch_id, assessment.key)
        is_deviating = assessment.trigger_type is not None

        if not is_deviating:
            if existing is not None:
                existing.status = 'Resolved'
                existing.resolved_at_elapsed_minutes = batch.elapsed_minutes
                existing.resolved_at = datetime.now(timezone.utc)
                self._persist()
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
                self._persist()
                return

            reasoning = await asyncio.to_thread(llm_agent.generate_alert_reasoning, assessment.llm_context or {})
            self._apply_reasoning(existing, assessment, reasoning, fingerprint)
            self._persist()
            return

        reasoning = await asyncio.to_thread(llm_agent.generate_alert_reasoning, assessment.llm_context or {})
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
        self._persist()

    def list_alerts(self, status: str | None = None) -> list[DeviationAlert]:
        alerts = list(self._alerts.values())
        if status:
            alerts = [a for a in alerts if a.status == status]
        return sorted(alerts, key=lambda a: a.created_at, reverse=True)

    def get(self, alert_id: str) -> DeviationAlert | None:
        return self._alerts.get(alert_id)

    def _set_human_decision(self, alert_id: str, decision: str) -> DeviationAlert | None:
        alert = self._alerts.get(alert_id)
        if alert is None:
            return None
        alert.human_decision = decision
        alert.human_decision_at = datetime.now(timezone.utc)
        self._persist()
        return alert

    def acknowledge(self, alert_id: str) -> DeviationAlert | None:
        return self._set_human_decision(alert_id, 'Acknowledged')

    def reject(self, alert_id: str) -> DeviationAlert | None:
        return self._set_human_decision(alert_id, 'Rejected')


alert_registry = AlertRegistry()
