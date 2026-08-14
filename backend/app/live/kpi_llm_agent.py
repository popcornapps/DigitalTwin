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
import threading

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
# kpi_prediction_agent.predict_kpis fires up to 5 of these reasoning calls
# concurrently (one per KPI) via ThreadPoolExecutor - guards the ONE-TIME
# client construction below, not the actual per-call chat.completions.create
# request (those still run fully concurrently, unlocked, right after this
# returns). Previously _client_init_attempted was set True before
# construction finished, so a thread arriving mid-construction could read
# "already attempted" and get back a still-None _client, silently falling
# back to Static with no error logged - confirmed live: a 5-concurrent-call
# run came back with only 1/5 as reasoning_source='llm'.
_client_init_lock = threading.Lock()


def _get_client():
    """Lazy singleton - constructed on first real use, not at import time, so
    a missing/broken Azure config doesn't crash the whole backend at startup.
    Thread-safe double-checked locking: the fast path (no lock) only ever
    sees _client_init_attempted=True once _client has its FINAL value
    (success or genuine failure) - see the lock block below - so a
    concurrent reader can never observe a half-initialized state."""
    global _client, _client_init_attempted
    if _client_init_attempted:
        return _client
    with _client_init_lock:
        if _client_init_attempted:  # another thread finished while we waited for the lock
            return _client
        if not (_AZURE_ENDPOINT and _AZURE_API_KEY and _AZURE_DEPLOYMENT):
            logger.warning(
                'Azure OpenAI not configured (AZURE_OPENAI_ENDPOINT/API_KEY/DEPLOYMENT) - '
                'the KPI Prediction Agent will use its deterministic fallback reasoning.'
            )
            _client_init_attempted = True
            return None
        try:
            # langfuse's drop-in wrapper - identical AzureOpenAI client, but every
            # call gets auto-traced (prompt/response/latency/cost) to Langfuse
            # when LANGFUSE_* env vars are set; a no-op passthrough otherwise.
            from langfuse.openai import AzureOpenAI
            _client = AzureOpenAI(
                azure_endpoint=_AZURE_ENDPOINT,
                api_key=_AZURE_API_KEY,
                api_version=_AZURE_API_VERSION,
            )
        except Exception:
            logger.exception('Failed to construct Azure OpenAI client - falling back to deterministic reasoning.')
            _client = None
        _client_init_attempted = True  # set LAST, only after _client has its final value
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
- Use only the evidence provided below. Never invent a numeric value, component, or parameter that isn't in \
the evidence.
- The evidence gives you this KPI's real formula chain: KPI -> component(s) -> the process parameter(s) that \
feed each component -> that parameter's deviation. Reason in that order: name the dominant component first \
(its estimated contribution %, when given), then the parameter behind it and its deviation - don't jump \
straight to a parameter without saying which part of the formula it belongs to.
- Contribution % on a component is an ESTIMATE reconstructed from the KPI's known formula, computed in \
parallel to the ML prediction above - it is not the model's own attribution. Don't present it as exact.
- Some components have NO parameter at all (their note says why - e.g. depends on final batch duration, or \
is a modeled input with no live sensor). State that plainly when it's the more likely explanation instead of \
inventing a parameter cause for it.
- If a component's own parameters aren't deviating much, but the KPI still shows a real deviation, say the \
tracked parameters look normal and point to whichever component's note best explains the gap instead of \
overstating a parameter that barely moved.
- This is a prediction of the batch's FINAL outcome, made from data available so far - not a 30-minute \
forecast. If the batch is still early, you may note the prediction could firm up as more data comes in, \
but always still give a real urgency level and one concrete next action.
- If you find yourself writing more than 2 sentences for a field, cut it down before answering."""


def _format_components(components: list[dict]) -> str:
    lines = [
        "Formula breakdown for this KPI (component -> the parameter(s) that feed it -> their deviation; "
        "contribution % is an estimate, not the model's own attribution):"
    ]
    for idx, comp in enumerate(components, start=1):
        contribution = comp.get('contribution_estimate')
        contribution_str = f" (~{round(contribution * 100)}% of the estimated deviation)" if contribution is not None else ''
        lines.append(f"  {idx}. {comp['name']}{contribution_str}")
        if comp.get('note'):
            lines.append(f"       {comp['note']}")
        for p in comp.get('parameters') or []:
            weight_pct = round(p['weight_within_component'] * 100)
            lines.append(
                f"       - {p['label']} (weight {weight_pct}% within this component): currently {p['current']} "
                f"{p['unit']} vs expected {p['golden']} {p['unit']} ({p['direction']}, deviation score {p['deviation_score']})"
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
        _format_components(context.get('components') or []),
    ]
    lines += [
        '',
        'Respond with each field 1-2 short sentences max (recommended_action may be up to 2 short bullet '
        'lines instead): kpi_summary (KPI + final direction vs Golden + severity, one sentence), '
        'deviation_explanation (why - name the dominant component from the formula breakdown, then the '
        'parameter behind it if it has one, or its note if it does not), urgency (exactly one of the allowed '
        'levels), recommended_action (the single most important corrective action, imperative voice), '
        'operational_impact (one sentence on what happens if ignored). Answer like a shift hand-off note - be brief.',
    ]
    return '\n'.join(lines)


# Matches kpi_prediction_agent.CONTRIBUTOR_SCORE_THRESHOLD's value - kept as
# an independent constant rather than an import, per this module's existing
# "zero imports from kpi_prediction_agent.py" isolation convention (see
# module docstring). Used only to decide whether a SECOND component is worth
# mentioning alongside the dominant one below.
_SECOND_CONTRIBUTOR_SIGNAL_THRESHOLD = 0.3


def _component_signal(component: dict) -> float:
    """Deviation signal strength for ranking components, independent of
    whether that component's formula gives a computable contribution
    PERCENTAGE - some components (e.g. Total Energy's Instability Penalty,
    which can't be split against the non-parameter Duration Extension term)
    have contribution_estimate=None but still have real, identifiable
    parameter deviations behind them, and must still be rankable so Static
    mode can name them - matching what the LLM already does by reading the
    full components list regardless of whether a percentage is attached."""
    if not component.get('parameters'):
        return -1.0
    return max(p['deviation_score'] * p['weight_within_component'] for p in component['parameters'])


def _fallback_reasoning(context: dict) -> dict:
    """Deterministic reasoning used when Azure OpenAI isn't configured or the
    call fails - a safety net only, not the primary reasoning path.

    Identifies the same component/parameter/contribution as the LLM prompt
    from the SAME evidence (components, weak_signal, kpi_formula_note),
    regardless of status - only the wording (template vs LLM) and the
    urgency/action framing differ by status. Previously a 'normal' status
    short-circuited straight to generic boilerplate before this identification
    ever ran, which is why Static could say "nothing is deviating" for a KPI
    (e.g. Total Energy) where Agent LLM, given the identical evidence, still
    named a real (just below-threshold) driver."""
    status = context['status']
    kpi_label = context['kpi_label']
    components = context.get('components') or []
    weak_signal = context.get('weak_signal', False)
    formula_note = context.get('kpi_formula_note')

    ranked = sorted((c for c in components if c.get('parameters')), key=_component_signal, reverse=True)
    leading_param = None

    if weak_signal and formula_note:
        # None of this KPI's real parameter drivers are actually moving much -
        # say so plainly and point at the formula's non-parameter cause,
        # rather than overstating whichever tracked parameter barely deviated.
        deviation_explanation = (
            f"None of {kpi_label}'s tracked process parameters are meaningfully deviating right now - {formula_note}"
        )
    elif ranked:
        dominant = ranked[0]
        leading_param = max(dominant['parameters'], key=lambda p: p['deviation_score'] * p['weight_within_component'])
        contribution_str = (
            f" (~{round(dominant['contribution_estimate'] * 100)}% of the estimated deviation)"
            if dominant.get('contribution_estimate') is not None else ''
        )
        deviation_explanation = (
            f"{dominant['name']}{contribution_str} is the main driver - "
            f"{leading_param['label']} is running {leading_param['direction']} from its expected value "
            f"({leading_param['current']} {leading_param['unit']} vs {leading_param['golden']} {leading_param['unit']})."
        )
        if dominant.get('note'):
            deviation_explanation += f' {dominant["note"]}'
        second = next((c for c in ranked[1:] if _component_signal(c) > _SECOND_CONTRIBUTOR_SIGNAL_THRESHOLD), None)
        if second:
            second_pct = (
                f" (~{round(second['contribution_estimate'] * 100)}%)" if second.get('contribution_estimate') is not None else ''
            )
            deviation_explanation += f" {second['name']}{second_pct} also contributes."
    else:
        deviation_explanation = 'No single process parameter stands out as the cause - the deviation may be cumulative or measurement noise.'

    if status == 'normal':
        kpi_summary = f'{kpi_label} is projected to finish close to the Golden Batch target.'
        urgency = 'Informational Only'
        recommended_action = (
            f"No corrective action needed yet - continue monitoring {leading_param['label']}, "
            'currently the largest (still minor) contributor.'
            if leading_param else
            'No action needed - continue routine monitoring.'
        )
        operational_impact = 'None expected if current conditions hold.'
    else:
        kpi_summary = f"{kpi_label} is projected to finish {context['deviation_pct']:+.1f}% from Golden - {status.title()}."
        urgency = 'Action Recommended Soon' if status == 'warning' else 'Immediate Action Required'
        if leading_param:
            recommended_action = _RECOMMENDATION_TEMPLATES.get(
                leading_param['key'], f"Investigate {leading_param['label']} - it is deviating the most right now."
            )
        elif weak_signal and formula_note:
            recommended_action = 'Review batch duration and non-parameter factors; continue monitoring tracked parameters for any new drift.'
        else:
            recommended_action = 'Increase monitoring frequency and review recent parameter trends manually.'
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
        # Deterministic trace_id from the batch id - every reasoning call for
        # the same running batch lands under one Langfuse trace instead of a
        # flat, unrelated list. The trace ID itself must be a 32-char hex
        # hash (Langfuse's required format, can't be arbitrary text), so the
        # batch id is also set as the trace's name/metadata - that's what's
        # actually human-readable in the dashboard's Traces list.
        from langfuse import get_client
        batch_id = context['running_batch_id']
        trace_id = get_client().create_trace_id(seed=batch_id)

        response = client.chat.completions.create(
            model=_AZURE_DEPLOYMENT,
            messages=[
                {'role': 'system', 'content': _SYSTEM_PROMPT},
                {'role': 'user', 'content': _build_user_prompt(context)},
            ],
            response_format=_RESPONSE_SCHEMA,
            trace_id=trace_id,
            name=f'kpi-reasoning-{batch_id}',
            metadata={'running_batch_id': batch_id, 'kpi_key': context.get('kpi_label')},
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
