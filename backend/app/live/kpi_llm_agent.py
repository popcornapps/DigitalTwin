"""The KPI Prediction & Deviation Agent's reasoning layer - mirrors
app.live.llm_agent's pattern exactly (same Azure OpenAI deployment, same
ai_mode toggle, same strict-JSON-schema + deterministic-fallback shape), just
producing KPI-focused text about a batch's FINAL predicted outcome instead of
parameter-alert text. Detect/Project (the predicted final value, Golden
comparison, status, and contributing-parameter ranking) are fully
deterministic elsewhere (kpi_prediction_agent.py builds that evidence) - this
module's only job is to turn already-decided facts into a short,
operator-facing explanation. It never decides the predicted value, the
status, or which parameter ranks highest; those are given as context.

Deliberately has zero imports from the historical/ML plane or from
kpi_prediction_agent.py's model-loading code - it only knows about the plain
evidence dict handed to it, same decoupling app.live.llm_agent already has
from deviation_agent.py.

Reuses app.live.ai_mode's existing global toggle (read-only import, not
modified) rather than introducing a second independent switch - Static mode
never calls Azure OpenAI at all; Agent LLM mode does, with the same
fallback-on-any-failure guarantee as the parameter agent's reasoning layer.
"""
import json
import logging
import os

from app.live import ai_mode

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

_OUTPUT_FIELDS = ('kpi_summary', 'deviation_explanation', 'urgency', 'recommended_action', 'operational_impact')

_RECOMMENDATION_TEMPLATES = {
    'temperature': 'Check heater/heat-exchanger calibration and drying-air temperature setpoint.',
    'process_pressure': 'Inspect the blower/damper and filter loading.',
    'flow_rate': 'Inspect the fan, duct, and filter for restriction or miscalibration.',
    'agitator_rpm': 'Inspect the agitator drive/bearings and VFD settings.',
}

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
            'the KPI Prediction Agent will use its deterministic fallback reasoning.'
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
        'name': 'kpi_reasoning',
        'schema': {
            'type': 'object',
            'properties': {
                'kpi_summary': {
                    'type': 'string',
                    'description': 'ONE short sentence: which KPI, its predicted final direction vs Golden, and severity. Max ~15 words.',
                },
                'deviation_explanation': {
                    'type': 'string',
                    'description': (
                        'ONE-TWO short sentences: why this KPI is predicted to end up off-target, referencing '
                        'which process parameter(s) are responsible, using only the supplied evidence.'
                    ),
                },
                'urgency': {'type': 'string', 'enum': URGENCY_LEVELS},
                'recommended_action': {
                    'type': 'string',
                    'description': (
                        'The single most important corrective action, as ONE short imperative sentence. If '
                        'more than one action is truly needed, at most 2 bullet lines separated by "\\n- ", '
                        'each under 10 words. No preamble.'
                    ),
                },
                'operational_impact': {
                    'type': 'string',
                    'description': 'ONE short sentence: what happens to the batch/product if this is left uncorrected.',
                },
            },
            'required': list(_OUTPUT_FIELDS),
            'additionalProperties': False,
        },
        'strict': True,
    },
}

_SYSTEM_PROMPT = """You are a manufacturing operations assistant embedded in a pharmaceutical batch \
monitoring system. A prediction of this batch's FINAL outcome for one KPI has ALREADY been computed by \
a deterministic model - you are not deciding the predicted value, the Golden Batch comparison, the status \
(Normal/Warning/Critical), or which process parameter ranks as most responsible; those are given to you \
as facts. Your job is the reasoning layer only: turn that evidence into a SHORT, scannable assessment a \
plant operator can read in a few seconds - not a written report.

Write like a shift hand-off note. Every field is 1-2 short sentences (or, for recommended_action only, up \
to 2 short bullet lines) - never a paragraph. Plain, direct, action-oriented words. No hedging ("it \
appears that"), no repeating a fact already stated in another field, no restating raw numbers already \
shown elsewhere on the page, no disclaimers unless they ARE the action to take.

Rules:
- Use only the evidence provided below. Never invent a numeric value or a parameter that isn't in the evidence.
- The contributing parameters are ranked by how far each is from its own expected value right now - treat \
the top-ranked one as the leading suspect, but you may mention a second if it's a close second.
- This is a prediction of the batch's FINAL outcome, made from data available so far - not a 30-minute \
forecast. If the batch is still early, you may note the prediction could firm up as more data comes in, \
but always still give a real urgency level and one concrete next action.
- If you find yourself writing more than 2 sentences for a field, cut it down before answering."""


def _format_contributors(contributors: list[dict]) -> str:
    if not contributors:
        return 'No process parameter is meaningfully deviating from its expected value right now.'
    lines = ['Contributing process parameters (ranked, most responsible first):']
    for c in contributors:
        lines.append(
            f"  - {c['label']}: currently {c['current']} {c['unit']} vs expected {c['golden']} {c['unit']} "
            f"({c['direction']}, deviation score {c['deviation_score']})"
        )
    return '\n'.join(lines)


def _build_user_prompt(context: dict) -> str:
    lines = [
        f"Batch: {context['running_batch_id']} at {context['plant']}, {context['elapsed_minutes']} minutes elapsed so far",
        f"KPI: {context['kpi_label']} ({context['unit']})",
        f"Predicted FINAL value for this batch: {context['predicted']:.2f} {context['unit']}",
        f"Golden Batch's final target: {context['golden']:.2f} {context['unit']}",
        f"Deviation from Golden: {context['deviation_pct']:+.1f}%",
        f"Status (already decided): {context['status']}",
        f"Model forecast confidence: {context['confidence']}",
        '',
        _format_contributors(context.get('contributing_parameters') or []),
        '',
        'Respond with each field 1-2 short sentences max (recommended_action may be up to 2 short bullet '
        'lines instead): kpi_summary (KPI + final direction vs Golden + severity, one sentence), '
        'deviation_explanation (why, referencing the leading contributing parameter(s)), urgency (exactly '
        'one of the allowed levels), recommended_action (the single most important corrective action, '
        'imperative voice), operational_impact (one sentence on what happens if ignored). Answer like a '
        'shift hand-off note - be brief.',
    ]
    return '\n'.join(lines)


def _fallback_reasoning(context: dict) -> dict:
    """Deterministic reasoning used when Azure OpenAI isn't configured or the
    call fails - a safety net only, not the primary reasoning path."""
    status = context['status']
    kpi_label = context['kpi_label']
    contributors = context.get('contributing_parameters') or []

    if status == 'normal':
        return {
            'kpi_summary': f'{kpi_label} is projected to finish close to the Golden Batch target.',
            'deviation_explanation': 'No process parameter is meaningfully deviating from its expected value right now.',
            'urgency': 'Informational Only',
            'recommended_action': 'No action needed - continue routine monitoring.',
            'operational_impact': 'None expected if current conditions hold.',
        }

    urgency = 'Action Recommended Soon' if status == 'warning' else 'Immediate Action Required'

    if contributors:
        leading = contributors[0]
        deviation_explanation = (
            f"{leading['label']} is running {leading['direction']} from its expected value "
            f"({leading['current']} {leading['unit']} vs {leading['golden']} {leading['unit']}), "
            f"the leading driver of this projected deviation."
        )
        recommended_action = _RECOMMENDATION_TEMPLATES.get(
            leading['key'], f"Investigate {leading['label']} - it is deviating the most right now."
        )
    else:
        deviation_explanation = 'No single process parameter stands out as the cause - the deviation may be cumulative or measurement noise.'
        recommended_action = 'Increase monitoring frequency and review recent parameter trends manually.'

    kpi_summary = f"{kpi_label} is projected to finish {context['deviation_pct']:+.1f}% from Golden - {status.title()}."
    operational_impact = (
        'Uncorrected, this increases the risk of an out-of-spec batch outcome and downstream quality review.'
        if status == 'critical' else
        'Uncorrected, this KPI may continue drifting further from the Golden Batch target by the time the batch finishes.'
    )

    return {
        'kpi_summary': kpi_summary,
        'deviation_explanation': deviation_explanation,
        'urgency': urgency,
        'recommended_action': recommended_action,
        'operational_impact': operational_impact,
    }


def generate_kpi_reasoning(context: dict) -> dict:
    """Returns a dict with exactly _OUTPUT_FIELDS plus `reasoning_source`
    ('static' | 'llm') - set here, never guessed downstream. In Static mode
    (the default), always uses the deterministic fallback and never calls
    Azure OpenAI at all. In Agent LLM mode, tries Azure OpenAI first and
    falls back to the same deterministic heuristic on any failure, so the
    operator is never left without guidance."""
    if ai_mode.get_mode() == ai_mode.STATIC:
        return {**_fallback_reasoning(context), 'reasoning_source': 'static'}

    client = _get_client()
    if client is None:
        return {**_fallback_reasoning(context), 'reasoning_source': 'static'}

    try:
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
        return {**parsed, 'reasoning_source': 'llm'}
    except Exception:
        logger.exception('Azure OpenAI call failed for KPI reasoning; falling back to deterministic heuristic')
        return {**_fallback_reasoning(context), 'reasoning_source': 'static'}
