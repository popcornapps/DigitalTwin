"""The Process Parameter Deviation Agent's reasoning layer - powered by an
Azure OpenAI chat model. Detect/Project/Alert are fully deterministic
elsewhere (deviation_agent.py builds the evidence, alert_registry.py decides
whether an alert exists and when to call this module). This module's only
job is to synthesize that evidence into a coherent, operator-facing
assessment - it never decides whether an alert fires, its severity, or its
trigger type; those are already-computed facts passed in as context.

Deliberately has zero imports from the historical/ML plane (app.state,
app.services, the trained model, etc.) - it only knows about the plain
context dict handed to it, keeping it as decoupled as alert_registry.py
already is.
"""
import json
import logging
import os

logger = logging.getLogger(__name__)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

_AZURE_ENDPOINT = os.environ.get('AZURE_OPENAI_ENDPOINT')
_AZURE_API_KEY = os.environ.get('AZURE_OPENAI_API_KEY')
_AZURE_DEPLOYMENT = os.environ.get('AZURE_OPENAI_DEPLOYMENT')
_AZURE_API_VERSION = os.environ.get('AZURE_OPENAI_API_VERSION', '2024-08-01-preview')

URGENCY_LEVELS = [
    'Immediate Action Required',
    'Action Recommended Soon',
    'Monitor Closely',
    'Informational Only',
]

_OUTPUT_FIELDS = (
    'alert_summary', 'trigger_explanation', 'urgency',
    'likely_root_cause', 'recommended_action', 'operational_impact',
)

_client = None
_client_init_attempted = False


def _get_client():
    """Lazy singleton - constructed on first real use, not at import time, so
    a missing/broken Azure config doesn't crash the whole backend at startup."""
    global _client, _client_init_attempted
    if _client_init_attempted:
        return _client
    _client_init_attempted = True
    if not (_AZURE_ENDPOINT and _AZURE_API_KEY and _AZURE_DEPLOYMENT):
        logger.warning(
            'Azure OpenAI not configured (AZURE_OPENAI_ENDPOINT/API_KEY/DEPLOYMENT) - '
            'the Deviation Agent will use its deterministic fallback reasoning.'
        )
        return None
    try:
        from openai import AzureOpenAI
        _client = AzureOpenAI(
            azure_endpoint=_AZURE_ENDPOINT,
            api_key=_AZURE_API_KEY,
            api_version=_AZURE_API_VERSION,
        )
    except Exception:
        logger.exception('Failed to construct Azure OpenAI client - falling back to deterministic reasoning.')
        _client = None
    return _client


_RESPONSE_SCHEMA = {
    'type': 'json_schema',
    'json_schema': {
        'name': 'alert_reasoning',
        'schema': {
            'type': 'object',
            'properties': {
                'alert_summary': {
                    'type': 'string',
                    'description': (
                        'ONE short sentence, plain language: which parameter, Current/Predicted/Both, '
                        'and severity. Max ~15 words.'
                    ),
                },
                'trigger_explanation': {
                    'type': 'string',
                    'description': (
                        'ONE short sentence: why this alert fired, using only the supplied evidence. '
                        'No restating the alert_summary, no extra qualifiers.'
                    ),
                },
                'urgency': {'type': 'string', 'enum': URGENCY_LEVELS},
                'likely_root_cause': {
                    'type': 'string',
                    'description': (
                        'ONE short sentence naming the best-fitting historical candidate and the one '
                        'piece of evidence for it, or "No strong historical match." if none fit. Not a '
                        'walkthrough of the ranking - just the conclusion.'
                    ),
                },
                'recommended_action': {
                    'type': 'string',
                    'description': (
                        'The single most important action, as ONE short imperative sentence '
                        '(e.g. "Reduce heater setpoint and verify sensor calibration."). If more than one '
                        'action is truly needed, at most 2-3 bullet lines separated by "\\n- ", each under '
                        '10 words. No numbered procedures, no preamble like "take the following steps".'
                    ),
                },
                'operational_impact': {
                    'type': 'string',
                    'description': (
                        'ONE short sentence: what happens if this is ignored. No restating confidence '
                        'level in words already shown elsewhere on the page.'
                    ),
                },
            },
            'required': list(_OUTPUT_FIELDS),
            'additionalProperties': False,
        },
        'strict': True,
    },
}

_SYSTEM_PROMPT = """You are a manufacturing operations assistant embedded in a pharmaceutical batch \
monitoring system. An alert has ALREADY been triggered by deterministic detection logic - you are not \
deciding whether it fires, its severity, or whether it's a current or predicted deviation; those are \
given to you as facts. Your job is the reasoning layer only: turn the evidence you're given into a \
SHORT, scannable assessment a plant operator can read in a few seconds while standing at the line - \
not a written report.

Write like a shift-hand-off note, not an analysis. Every field is 1-2 short sentences (or, for \
recommended_action only, up to 3 short bullet lines) - never a paragraph. Plain, direct, action-oriented \
words - say "Reduce heater setpoint," not "It is recommended that operators consider reducing the \
heater setpoint." No hedging ("it appears that", "it is possible that"), no repeating a fact you already \
stated in another field, no restating the raw numbers already shown elsewhere on the page, no closing \
caveats or disclaimers unless they ARE the action to take.

Rules:
- Use only the evidence provided below. Never invent a numeric value, a historical batch count, or a \
fault scenario that isn't in the evidence.
- The ranked historical fault candidates are evidence to weigh, not an answer key (e.g. a candidate that \
would also move a parameter that ISN'T deviating here is weaker evidence than one whose full signature \
matches) - but only report your CONCLUSION in one sentence, not the comparison itself. If none fit well, \
say so in one short sentence rather than forcing a diagnosis.
- Regardless of whether a root cause is clear, always give a real urgency level and one concrete next \
action - the operator must never be left without guidance just because the cause is unclear.
- If you find yourself writing more than 2 sentences for a field, cut it down before answering."""


def _format_candidates(candidates: list[dict]) -> str:
    if not candidates:
        return 'No historical fault signature matches this deviation pattern at all.'
    lines = ['Ranked historical fault signature candidates (most to least likely, derived from real historical batch data):']
    for i, cand in enumerate(candidates, 1):
        evidence = ', '.join(
            f"{e['parameter']}: expected {e['expected_direction']}, observed "
            f"{e['observed_direction'] or 'no deviation'} ({'MATCH' if e['matched'] else 'no match'})"
            for e in cand['parameter_evidence']
        )
        lines.append(
            f"  {i}. {cand['scenario'].replace('_', ' ')} - seen in {cand['batch_count']} historical "
            f"batch(es), {cand['match_fraction'] * 100:.0f}% of its signature parameters match here. "
            f"Evidence: {evidence}"
        )
    return '\n'.join(lines)


def _build_user_prompt(context: dict) -> str:
    unit = context['unit']
    lines = [
        f"Batch: {context['running_batch_id']} at {context['plant']}",
        f"Parameter: {context['parameter_label']} ({unit})",
        f"Deviation type (already decided): {context['trigger_type']} (current / predicted / both)",
        f"Alert severity (already decided): {context['severity']}",
        '',
    ]

    current = context.get('current')
    if current:
        lines.append(
            f"Current reading: {current['value']:.2f} {unit} vs golden batch {current['golden']:.2f} {unit} "
            f"(expected range {current['lower']:.2f} to {current['upper']:.2f}), status = {current['status']}"
        )

    predicted = context.get('predicted')
    if predicted:
        lines.append(
            f"Model forecast 30 min ahead: {predicted['value']:.2f} {unit} vs golden batch "
            f"{predicted['golden']:.2f} {unit}, status = {predicted['status']}, model confidence = {predicted['confidence']}"
        )
        if predicted.get('time_to_breach_minutes') is not None:
            lines.append(f"Estimated time to breach the expected range: {predicted['time_to_breach_minutes']} minutes")
        else:
            lines.append('No reliable time-to-breach estimate available (trend too flat, or the projection is too far out to be meaningful).')

    if context.get('co_deviating'):
        lines.append('Other parameters deviating at the same time: ' + '; '.join(context['co_deviating']))

    lines.append('')
    lines.append(_format_candidates(context.get('root_cause_candidates') or []))

    lines.append('')
    lines.append(
        'Respond with, each field 1-2 short sentences max (recommended_action may be up to 3 short bullet '
        'lines instead): alert_summary (what + Current/Predicted/Both + severity, one sentence), '
        'trigger_explanation (why it fired, one sentence), urgency (exactly one of the allowed levels), '
        'likely_root_cause (the conclusion only - which candidate fits and the one reason why, or "No '
        'strong historical match."), recommended_action (the single most important action operators should '
        'take, imperative voice), operational_impact (one sentence on what happens if ignored). '
        'Answer like a shift hand-off note, not a report - be brief.'
    )
    return '\n'.join(lines)


def _fallback_reasoning(context: dict) -> dict:
    """Deterministic reasoning used when Azure OpenAI isn't configured or the
    call fails - a safety net only, not the primary reasoning path. Keeps the
    agent giving real guidance rather than going silent on an LLM outage."""
    severity = context['severity']
    predicted = context.get('predicted') or {}
    time_to_breach = predicted.get('time_to_breach_minutes')

    if severity == 'Critical' and time_to_breach is not None and time_to_breach < 15:
        urgency = 'Immediate Action Required'
    elif severity == 'Critical':
        urgency = 'Action Recommended Soon'
    elif severity == 'Warning' and time_to_breach is not None and time_to_breach < 30:
        urgency = 'Action Recommended Soon'
    elif severity == 'Warning':
        urgency = 'Monitor Closely'
    else:
        urgency = 'Informational Only'

    which = {'current': 'is currently', 'predicted': 'is forecast to be', 'both': 'is currently, and is forecast to remain,'}[context['trigger_type']]
    alert_summary = f"{context['parameter_label']} {which} outside its expected range - {severity} alert."
    trigger_explanation = f"{context['parameter_label']} {which} outside the Golden(t)+/-margin band, meeting the {severity} threshold."

    candidates = context.get('root_cause_candidates') or []
    if candidates:
        top = candidates[0]
        likely_root_cause = (
            f"Closest historical match: '{top['scenario'].replace('_', ' ')}' "
            f"({top['batch_count']} similar batch(es) on record, {top['match_fraction'] * 100:.0f}% parameter match)."
        )
        recommended_action = top['recommended_action']
    else:
        likely_root_cause = 'No historical batch shows a clear match for this deviation pattern - treat as a novel or unclassified deviation.'
        recommended_action = (
            'No matching historical corrective action on record. Notify the shift supervisor, increase '
            'manual monitoring frequency for this parameter, and log the deviation for review.'
        )

    confidence = predicted.get('confidence')
    operational_impact = (
        f"Model confidence in this forecast is {confidence}. " if confidence else ''
    ) + 'Uncorrected, this increases the risk of an out-of-spec batch and downstream quality investigation.'

    return {
        'alert_summary': alert_summary,
        'trigger_explanation': trigger_explanation,
        'urgency': urgency,
        'likely_root_cause': likely_root_cause,
        'recommended_action': recommended_action,
        'operational_impact': operational_impact,
    }


def generate_alert_reasoning(context: dict) -> dict:
    """Returns a dict with exactly _OUTPUT_FIELDS. Tries Azure OpenAI first
    (the primary reasoning path); falls back to a deterministic heuristic on
    any failure so the operator is never left without guidance."""
    client = _get_client()
    if client is None:
        return _fallback_reasoning(context)

    try:
        # No explicit temperature - some Azure deployments (reasoning-tier
        # models in particular) reject any value other than the default (1)
        # and error out on the request entirely.
        response = client.chat.completions.create(
            model=_AZURE_DEPLOYMENT,
            messages=[
                {'role': 'system', 'content': _SYSTEM_PROMPT},
                {'role': 'user', 'content': _build_user_prompt(context)},
            ],
            response_format=_RESPONSE_SCHEMA,
        )
        parsed = json.loads(response.choices[0].message.content)
        if parsed.get('urgency') not in URGENCY_LEVELS:
            raise ValueError(f"model returned an invalid urgency value: {parsed.get('urgency')!r}")
        if any(field not in parsed for field in _OUTPUT_FIELDS):
            raise ValueError(f'model response missing required fields: {parsed.keys()}')
        return parsed
    except Exception:
        logger.exception('Azure OpenAI call failed for alert reasoning; falling back to deterministic heuristic')
        return _fallback_reasoning(context)
