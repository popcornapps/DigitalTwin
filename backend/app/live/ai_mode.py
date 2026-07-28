"""Global AI Analysis Mode switch - controls whether the Deviation Agent's
LLM reasoning layer (alert_summary, trigger_explanation, urgency,
likely_root_cause, recommended_action, operational_impact) comes from the
real Azure OpenAI call or the deterministic fallback template that already
exists in app.live.llm_agent. Root Cause/Recommendation Confidence
(app.live.confidence) are unaffected either way - those are deterministic by
design regardless of this mode.

Deliberately a tiny, standalone module (not a field on config.py) so this is
the ONE seam a caller needs: app.live.llm_agent.generate_alert_reasoning
checks get_mode() and nothing else in the reasoning pipeline
(deviation_agent.py, alert_registry.py) needs to know this exists.

In production this mode would be set once at startup from an env var
(mirroring live/config.py's LIVE_BATCH_SPEED_PROFILE pattern) and the
set_mode()-backed toggle endpoint simply wouldn't be registered/exposed -
the UI toggle in Process Monitoring is a POC-only convenience for flipping
this at runtime without a restart.
"""

STATIC = 'static'
AGENT_LLM = 'agent_llm'

_VALID_MODES = (STATIC, AGENT_LLM)

# Default: Static - matches the current product decision to keep LLM cost
# opt-in rather than automatic for every deviation.
_mode = STATIC


def get_mode() -> str:
    return _mode


def set_mode(mode: str) -> str:
    global _mode
    if mode not in _VALID_MODES:
        raise ValueError(f"Unknown AI mode {mode!r} - must be one of {_VALID_MODES}")
    _mode = mode
    return _mode
