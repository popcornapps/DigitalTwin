-- PharmaTwin: alerts table - replaces data/live_alerts_store.json.
--
-- Unlike the 7 historical/ML tables (read-only reference data, loaded once
-- at startup), this is genuinely mutable runtime state: created/updated on
-- every live-batch tick, read by the AI Review Desk poll every 3s. That's
-- exactly the profile a JSON file handles badly (full-file rewrite per
-- write, linear scan per lookup, no atomic writes) and Postgres handles
-- natively (single-row UPSERT, indexed lookup, real transactions) - so no
-- retention cap is needed here the way one was on the JSON file.
--
-- Field-for-field match to backend/app/live/models.py's DeviationAlert
-- dataclass and backend/app/schemas/alert.py's DeviationAlertOut.

BEGIN;

CREATE TABLE alerts (
    alert_id                              text PRIMARY KEY,
    running_batch_id                      text NOT NULL,  -- no FK: running batches are in-memory/ephemeral by design
    plant                                 text NOT NULL,
    parameter                             text NOT NULL,
    trigger_type                          text NOT NULL CHECK (trigger_type IN ('current', 'predicted', 'both')),
    severity                              text NOT NULL CHECK (severity IN ('Warning', 'Critical')),
    detected_at_elapsed_minutes           integer NOT NULL,
    created_at                            timestamptz NOT NULL,
    observation                           text NOT NULL,
    predicted_observation                 text,
    time_to_breach_minutes                double precision,
    confidence                            text CHECK (confidence IN ('High', 'Medium', 'Low') OR confidence IS NULL),
    likely_root_cause                     text,
    recommended_action                    text,
    status                                text NOT NULL CHECK (status IN ('Open', 'Resolved')),
    resolved_at_elapsed_minutes           integer,
    resolved_at                           timestamptz,
    alert_summary                         text,
    trigger_explanation                   text,
    urgency                               text,
    operational_impact                    text,
    root_cause_confidence_pct             integer CHECK (root_cause_confidence_pct BETWEEN 0 AND 100 OR root_cause_confidence_pct IS NULL),
    root_cause_confidence_level           text,
    root_cause_confidence_explanation     text,
    recommendation_confidence_pct         integer CHECK (recommendation_confidence_pct BETWEEN 0 AND 100 OR recommendation_confidence_pct IS NULL),
    recommendation_confidence_level       text,
    recommendation_confidence_explanation text,
    reasoning_source                      text CHECK (reasoning_source IN ('static', 'llm') OR reasoning_source IS NULL),
    human_decision                        text CHECK (human_decision IN ('Acknowledged', 'Rejected') OR human_decision IS NULL),
    human_decision_at                     timestamptz,
    -- Internal cache key for the LLM re-reasoning skip check (trigger_type,
    -- severity, top root-cause candidate) - never serialized to the API,
    -- but must persist across restarts for that check to work correctly.
    reasoning_fingerprint                 jsonb
);

CREATE INDEX idx_alerts_running_batch ON alerts (running_batch_id);
CREATE INDEX idx_alerts_status ON alerts (status);
CREATE INDEX idx_alerts_created_at ON alerts (created_at DESC);
-- Matches _find_open's exact lookup pattern (one open alert per batch+parameter).
CREATE INDEX idx_alerts_open_lookup ON alerts (running_batch_id, parameter, status);

COMMIT;
