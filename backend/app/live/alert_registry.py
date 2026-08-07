"""Persistence layer for DeviationAlert records - the Alert capability's
storage. Synced once per tick from the Deviation Agent's assessment output,
right after deviation_agent.assess() runs. Unlike latest_prediction/
latest_assessments (overwritten every tick), an alert persists once created -
updated in place while the deviation continues, marked 'Resolved' once it
clears - which is what makes it a real, durable inbox item rather than a
transient display value.

Persisted in the `alerts` Postgres table (see scripts/postgres-migration/
schema_alerts.sql), read/written directly on every operation - so the AI
Review Desk acts as a true recommendation history that survives a backend
restart, not just an in-memory list that resets every time the process
restarts (which happens often in dev, since --reload restarts on every .py
file change). This used to be a hand-rolled JSON file
(data/live_alerts_store.json, rewritten in full on every single mutation);
Postgres does a single-row INSERT/UPDATE instead, and an indexed lookup
instead of scanning every alert in memory for _find_open - the two things
that made the JSON file get slower, not just bigger, the longer the backend
ran. No in-memory cache is kept: every method queries/mutates the table
directly, since a few thousand rows queried a few times a second is well
within what Postgres does without needing one.

list_alerts() only returns the last DISPLAY_RETENTION (currently 2 days) -
a POC-scoped display limit, not a storage one. Every alert ever created
stays in the table regardless; nothing here deletes anything. That's a
deliberate difference from the old JSON file's retention, where pruning was
load-bearing (the file itself had to stay small). Here it's purely a UI
scoping choice, easy to widen or remove later without any data loss.

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
import logging
from datetime import datetime, timedelta, timezone

import psycopg2.extras

from app.db import get_connection
from app.live import llm_agent
from app.live.models import DeviationAlert, ParameterAssessment, RunningBatch

logger = logging.getLogger(__name__)

# POC-scoped display window for the AI Review Desk - full history stays in
# Postgres regardless (unlike the old JSON file, storage isn't the
# constraint here), this only limits what list_alerts() returns. Revisit
# when this moves from occasional demo use to real sustained usage - at
# that scale, prefer archiving old resolved alerts over deleting them, so
# audit history isn't lost.
DISPLAY_RETENTION = timedelta(days=2)

# Column order used for every SELECT/INSERT/UPDATE below - matches
# DeviationAlert's field order exactly (see app.live.models).
ALERT_COLUMNS = [
    'alert_id', 'running_batch_id', 'plant', 'parameter', 'trigger_type', 'severity',
    'detected_at_elapsed_minutes', 'created_at', 'observation', 'predicted_observation',
    'time_to_breach_minutes', 'confidence', 'likely_root_cause', 'recommended_action',
    'status', 'resolved_at_elapsed_minutes', 'resolved_at',
    'alert_summary', 'trigger_explanation', 'urgency', 'operational_impact',
    'root_cause_confidence_pct', 'root_cause_confidence_level', 'root_cause_confidence_explanation',
    'recommendation_confidence_pct', 'recommendation_confidence_level', 'recommendation_confidence_explanation',
    'reasoning_source', 'human_decision', 'human_decision_at', 'reasoning_fingerprint', 'source',
]


def _row_to_alert(row: tuple) -> DeviationAlert:
    d = dict(zip(ALERT_COLUMNS, row))
    if d['reasoning_fingerprint'] is not None:
        d['reasoning_fingerprint'] = tuple(d['reasoning_fingerprint'])
    return DeviationAlert(**d)


def _alert_values(alert: DeviationAlert) -> list:
    values = []
    for col in ALERT_COLUMNS:
        v = getattr(alert, col)
        if col == 'reasoning_fingerprint' and v is not None:
            v = psycopg2.extras.Json(list(v))
        values.append(v)
    return values


class AlertRegistry:
    def __init__(self):
        self._seq = self._load_seq()

    @staticmethod
    def _load_seq() -> int:
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute('SELECT alert_id FROM alerts')
            ids = [r[0] for r in cur.fetchall()]
        if not ids:
            return 0
        # Keep handing out fresh IDs after a restart, not colliding with
        # whatever's already stored (ALERT-0001, ALERT-0002, ...).
        return max(int(aid.split('-')[1]) for aid in ids)

    def _next_id(self) -> str:
        self._seq += 1
        return f'ALERT-{self._seq:04d}'

    @staticmethod
    def _find_open(batch_id: str, parameter: str) -> DeviationAlert | None:
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute(
                f"SELECT {', '.join(ALERT_COLUMNS)} FROM alerts "
                "WHERE running_batch_id = %s AND parameter = %s AND status = 'Open' LIMIT 1",
                (batch_id, parameter),
            )
            row = cur.fetchone()
        return _row_to_alert(row) if row else None

    @staticmethod
    def _insert(alert: DeviationAlert) -> None:
        col_list = ', '.join(ALERT_COLUMNS)
        placeholders = ', '.join(['%s'] * len(ALERT_COLUMNS))
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute(f'INSERT INTO alerts ({col_list}) VALUES ({placeholders})', _alert_values(alert))
            conn.commit()

    @staticmethod
    def _update(alert: DeviationAlert) -> None:
        set_clause = ', '.join(f'{col} = %s' for col in ALERT_COLUMNS if col != 'alert_id')
        values = [getattr(alert, col) if col != 'reasoning_fingerprint' or getattr(alert, col) is None
                  else psycopg2.extras.Json(list(getattr(alert, col)))
                  for col in ALERT_COLUMNS if col != 'alert_id']
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute(f'UPDATE alerts SET {set_clause} WHERE alert_id = %s', values + [alert.alert_id])
            conn.commit()

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
        target.reasoning_source = reasoning['reasoning_source']
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
        assessment.reasoning_source = reasoning['reasoning_source']

    async def sync_from_assessment(self, batch: RunningBatch, assessment: ParameterAssessment) -> None:
        existing = self._find_open(batch.running_batch_id, assessment.key)
        is_deviating = assessment.trigger_type is not None

        if not is_deviating:
            if existing is not None:
                existing.status = 'Resolved'
                existing.resolved_at_elapsed_minutes = batch.elapsed_minutes
                existing.resolved_at = datetime.now(timezone.utc)
                self._update(existing)
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
            existing.root_cause_confidence_pct = assessment.root_cause_confidence_pct
            existing.root_cause_confidence_level = assessment.root_cause_confidence_level
            existing.root_cause_confidence_explanation = assessment.root_cause_confidence_explanation
            existing.recommendation_confidence_pct = assessment.recommendation_confidence_pct
            existing.recommendation_confidence_level = assessment.recommendation_confidence_level
            existing.recommendation_confidence_explanation = assessment.recommendation_confidence_explanation

            if existing.reasoning_fingerprint == fingerprint:
                # No material change - keep the persisted narrative stable,
                # just mirror it back so the live view matches.
                assessment.alert_summary = existing.alert_summary
                assessment.trigger_explanation = existing.trigger_explanation
                assessment.urgency = existing.urgency
                assessment.likely_root_cause = existing.likely_root_cause
                assessment.recommended_action = existing.recommended_action
                assessment.operational_impact = existing.operational_impact
                assessment.reasoning_source = existing.reasoning_source
                self._update(existing)
                return

            reasoning = await asyncio.to_thread(llm_agent.generate_alert_reasoning, assessment.llm_context or {})
            self._apply_reasoning(existing, assessment, reasoning, fingerprint)
            self._update(existing)
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
            root_cause_confidence_pct=assessment.root_cause_confidence_pct,
            root_cause_confidence_level=assessment.root_cause_confidence_level,
            root_cause_confidence_explanation=assessment.root_cause_confidence_explanation,
            recommendation_confidence_pct=assessment.recommendation_confidence_pct,
            recommendation_confidence_level=assessment.recommendation_confidence_level,
            recommendation_confidence_explanation=assessment.recommendation_confidence_explanation,
        )
        self._apply_reasoning(alert, assessment, reasoning, fingerprint)
        self._insert(alert)

    async def sync_from_kpi_prediction(self, batch: RunningBatch, kpi_calc: dict) -> None:
        """Same create/update/resolve pattern as sync_from_assessment, but for
        one KPI's prediction (kpi_calc, one entry from predict_kpis()'s
        `kpis` list) rather than one process parameter's assessment. Simpler
        than that method: predict_kpis() already caches its own LLM reasoning
        internally (keyed by (running_batch_id, kpi_key) + a status/top-
        contributor fingerprint - see kpi_prediction_agent.py's
        _reasoning_cache), so by the time kpi_calc reaches here its narrative
        fields are already stable - no second fingerprint-gating layer is
        needed here, just write whatever's currently in kpi_calc."""
        existing = self._find_open(batch.running_batch_id, kpi_calc['key'])

        if kpi_calc['status'] == 'normal':
            if existing is not None:
                existing.status = 'Resolved'
                existing.resolved_at_elapsed_minutes = batch.elapsed_minutes
                existing.resolved_at = datetime.now(timezone.utc)
                self._update(existing)
            return

        severity = kpi_calc['status'].title()  # 'warning'/'critical' -> 'Warning'/'Critical'
        contributors = kpi_calc.get('contributing_parameters') or []
        likely_root_cause = (
            f"Primarily driven by {contributors[0]['label']} deviation from golden reference."
            if contributors else None
        )

        if existing is not None:
            existing.severity = severity
            existing.observation = kpi_calc['deviation_explanation']
            existing.confidence = kpi_calc['confidence']
            existing.likely_root_cause = likely_root_cause
            existing.recommended_action = kpi_calc['recommended_action']
            existing.alert_summary = kpi_calc['kpi_summary']
            existing.trigger_explanation = kpi_calc['deviation_explanation']
            existing.urgency = kpi_calc['urgency']
            existing.operational_impact = kpi_calc['operational_impact']
            existing.reasoning_source = kpi_calc['reasoning_source']
            self._update(existing)
            return

        alert = DeviationAlert(
            alert_id=self._next_id(),
            running_batch_id=batch.running_batch_id,
            plant=batch.plant,
            parameter=kpi_calc['key'],
            trigger_type='predicted',
            severity=severity,
            detected_at_elapsed_minutes=batch.elapsed_minutes,
            created_at=datetime.now(timezone.utc),
            observation=kpi_calc['deviation_explanation'],
            predicted_observation=None,
            time_to_breach_minutes=None,
            confidence=kpi_calc['confidence'],
            likely_root_cause=likely_root_cause,
            recommended_action=kpi_calc['recommended_action'],
            status='Open',
            alert_summary=kpi_calc['kpi_summary'],
            trigger_explanation=kpi_calc['deviation_explanation'],
            urgency=kpi_calc['urgency'],
            operational_impact=kpi_calc['operational_impact'],
            reasoning_source=kpi_calc['reasoning_source'],
            source='kpi_prediction',
        )
        self._insert(alert)

    @staticmethod
    def list_alerts(status: str | None = None) -> list[DeviationAlert]:
        cutoff = datetime.now(timezone.utc) - DISPLAY_RETENTION
        query = f"SELECT {', '.join(ALERT_COLUMNS)} FROM alerts WHERE created_at > %s"
        params: list = [cutoff]
        if status:
            query += ' AND status = %s'
            params.append(status)
        query += ' ORDER BY created_at DESC'
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()
        return [_row_to_alert(row) for row in rows]

    @staticmethod
    def get(alert_id: str) -> DeviationAlert | None:
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute(f"SELECT {', '.join(ALERT_COLUMNS)} FROM alerts WHERE alert_id = %s", (alert_id,))
            row = cur.fetchone()
        return _row_to_alert(row) if row else None

    def _set_human_decision(self, alert_id: str, decision: str) -> DeviationAlert | None:
        alert = self.get(alert_id)
        if alert is None:
            return None
        alert.human_decision = decision
        alert.human_decision_at = datetime.now(timezone.utc)
        self._update(alert)
        return alert

    def acknowledge(self, alert_id: str) -> DeviationAlert | None:
        return self._set_human_decision(alert_id, 'Acknowledged')

    def reject(self, alert_id: str) -> DeviationAlert | None:
        return self._set_human_decision(alert_id, 'Rejected')


alert_registry = AlertRegistry()
