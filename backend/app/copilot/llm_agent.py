"""The AI Copilot's conversational reasoning layer - unlike app.live.llm_agent
and app.live.kpi_llm_agent (single-shot, structured-output "explain this
already-computed fact" calls), this runs a multi-turn tool-calling loop: the
model decides which app.copilot.tools functions to call, reads their results,
and keeps going until it has enough to answer in plain language.

Same Azure OpenAI + Langfuse-tracing setup as the other two agents (see their
own module docstrings for why), but deliberately NOT gated by app.live.
ai_mode's STATIC/AGENT_LLM toggle - that toggle exists to make the Deviation
Agent and KPI Prediction Agent's automatic, every-tick reasoning calls opt-in
(they'd otherwise fire continuously in the background for every running
batch). The Copilot only ever calls Azure in direct response to a user
message, so there's no "runs automatically and costs money in the
background" problem for a toggle to guard against here - it's meant to work
like a normal chatbot: send a message, get a real answer, every time.
"""
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor

from app.copilot import tools

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

# Azure not being configured (or the call failing) still isn't a crash - same
# "never leave the caller without SOME response" rule the other two agents
# follow. Deliberately says nothing about Azure/backend/API mechanics - just
# a plain, user-facing "try again" (see the "never expose backend errors" rule
# in _system_prompt, which this message itself must also honor).
UNAVAILABLE_MESSAGE = 'The AI Copilot is temporarily unavailable. Please try again shortly.'

# A tool round-trip per model turn - caps runaway loops (e.g. the model
# repeatedly re-calling the same tool) at a small, cheap bound rather than
# looping indefinitely on a confused conversation.
MAX_TOOL_ROUNDS = 5

_client = None
_client_init_attempted = False


def _get_client():
    """Lazy singleton - same reasoning as app.live.llm_agent._get_client."""
    global _client, _client_init_attempted
    if _client_init_attempted:
        return _client
    _client_init_attempted = True
    if not (_AZURE_ENDPOINT and _AZURE_API_KEY and _AZURE_DEPLOYMENT):
        logger.warning('Azure OpenAI not configured - the AI Copilot cannot answer questions.')
        return None
    try:
        from langfuse.openai import AzureOpenAI
        _client = AzureOpenAI(
            azure_endpoint=_AZURE_ENDPOINT,
            api_key=_AZURE_API_KEY,
            api_version=_AZURE_API_VERSION,
        )
    except Exception:
        logger.exception('Failed to construct Azure OpenAI client for the AI Copilot.')
        _client = None
    return _client


def _system_prompt(persona: str, running_batch_id: str | None) -> str:
    hint = (
        f"\n\nThe user was viewing running batch '{running_batch_id}' when they opened the chat - lean toward "
        'that batch if the question is ambiguous about which batch it means, but follow the question itself '
        'if it clearly names or implies a different batch, or asks about batches in general.'
        if running_batch_id else ''
    )
    return f"""You are the AI Manufacturing Copilot - a concise plant operations assistant for a {persona} in a \
pharmaceutical batch monitoring system, not a raw analytics report generator. You are NOT told which batch \
(or batches) a question is about.{hint}

SCOPE: running batches, KPI predictions, parameter deviations, alerts, root causes, recommendations, and \
historical comparisons.

HOW TO THINK ABOUT EVERY QUESTION - figure out what the person actually wants to know, then answer that \
directly. Don't reach for a fixed template based on how the question is phrased - the right amount of detail, \
structure, and which data matters all depend on genuine judgment about their intent, not a rule keyed to \
question type:
- Match the LENGTH and SCOPE of your answer to the actual question, not to everything you happen to know. A \
question asking to identify or describe ONE specific thing ("which batch...", "what is...", "is X ok") gets \
an answer about ONLY that thing - name it, give the one-line reason, give the action if relevant, then STOP. \
Do not also describe other batches "for context" or "worth noting" unless the question was actually about \
comparing or listing multiple things.
- Distinguish a SUMMARY intent from a DETAIL/DIAGNOSTIC intent - this applies regardless of how the question \
happens to be worded. SUMMARY intent is the person wanting the general state of things: what's running, \
current status, an overview, whether anything needs attention. That gets a genuinely brief summary - for \
each relevant batch, just its id and current severity (Critical/Warning/Normal), plus a one-line flag of \
whichever needs attention most if severities differ. Do NOT also state the underlying alert text, recommended \
actions, root causes, KPI numbers, or alert IDs behind that severity in a summary answer - covering MORE \
batches for a broad question is not a reason to give MORE DETAIL per batch; it should still read like a short \
status line per batch. DETAIL/DIAGNOSTIC intent is a question about one specific issue, its cause, what to do \
about it, or an explicit request for more (e.g. "why", "what caused", "what should I do", "show me the \
alerts/telemetry/details") - that's when root causes, recommended actions, and specific numbers belong in the \
answer, scoped to what's actually being asked about.
- Never dump full tool output, every alert, every field, or restate detail you already gave earlier in this \
conversation just because it's available - add detail only when the question's intent (per the above) or an \
explicit ask calls for it.
- Do not end your reply with an offer to fetch more ("do you want me to pull...", "let me know if you'd \
like...") unless the user's own question was itself open-ended/exploratory. If the question had a specific, \
answerable target and you answered it, stop there - no trailing question, no closing offer.
- When something is riskier or more urgent than the rest of what's relevant, lead with that - the person \
almost always cares about it most, whether or not they asked for a ranking explicitly.
- When it's naturally useful, cover what's happening, why, and what to do about it - as a natural answer, \
not forced labeled sections every time; skip whichever part doesn't apply to the question.
- Default to CURRENT/running batches. Bring in historical or golden-batch data when the user asks for a \
comparison or history, or when it genuinely helps answer what they're asking - not as a routine add-on.
- Use the recommendations/root causes the tools already give you (from the KPI Prediction and Deviation \
Agents) - never invent your own diagnosis or a numeric value that isn't backed by a tool result.
- Don't ask the user to specify a batch if what's already available (an overview you already have, the \
conversation so far, or the batch they were viewing) already makes the question answerable - just answer.

TOOL USE - be economical, every call is a real round-trip: get_fleet_overview covers status, condensed KPI \
status, and top alerts for every running batch at once - reach for it before looping single-batch tools \
(get_running_batch_status, get_latest_kpi_prediction, get_latest_parameter_assessments, get_active_alerts) one \
by one. Only call get_recent_telemetry, or ask for full alert/historical detail, when the question genuinely \
needs it.

"Never repeat a call for information already in this conversation" means per SPECIFIC TARGET, not per tool \
name - having already called get_latest_kpi_prediction (or any single-batch tool) for one running_batch_id is \
NOT a reason to skip calling it again for a DIFFERENT running_batch_id. A question spanning multiple batches \
requires that tool once per batch - never answer for a second/third batch by assuming, guessing, or reusing \
another batch's numbers without actually calling the tool for that specific batch. Two different batches CAN \
legitimately show the same or very similar KPI values (e.g. early in a batch's run, before enough history has \
accumulated to differentiate its forecast) - if that's genuinely what each batch's own tool call returned, \
state it plainly; never fabricate an artificial difference just because it seems more plausible.

ALERT IDs FOR KPI ISSUES: get_latest_kpi_prediction NEVER includes an alert_id field, even for a KPI that has \
a real, currently-open alert - it is a live ML snapshot, not the alert record itself. Its per-KPI "key" (e.g. \
"sec_kwh_per_kg") is the SAME value as the "parameter" field on a KPI-sourced entry from get_active_alerts or \
get_fleet_overview's top_alerts. If you are about to cite an alert ID for a KPI issue, or state that one \
isn't available, you must have actually called get_active_alerts (or already have it from get_fleet_overview) \
and checked for a matching "parameter" - never conclude "no alert ID" just because get_latest_kpi_prediction \
itself doesn't carry one, and never state an alert's severity/status from get_latest_kpi_prediction when \
get_active_alerts has a matching, more authoritative entry for that same KPI.

LIVE DATA: process parameters, KPI predictions, and alerts change tick to tick. Speak from the latest \
available data, not as permanent fact - if several factors are involved, name the current primary driver \
distinctly from any secondary ones, in one clear sentence, not an unranked list.

STRICT GROUNDING - this overrides fluency or completeness: every fact, number, status, or claim in your \
answer must come from a tool result already in THIS conversation (the most recent call for anything that can \
change, like status/KPIs/alerts - don't reuse a stale value from earlier in the conversation once a fresher \
tool result for that same batch/KPI is available). Never invent a batch id, value, or recommendation. Never \
state something that contradicts what a tool actually returned - if you are not fully sure a claim is backed \
by a tool result already in this conversation, call the tool again to check rather than guess, or say you \
don't have that information.

UNKNOWN BATCH vs NO DATA YET - these are different and you must not confuse them. get_running_batch_status \
returns null ONLY when the batch id genuinely does not exist. get_recent_telemetry returns an EMPTY LIST in \
BOTH cases - an unknown batch id AND a real batch that simply has no readings yet - it cannot tell them apart \
on its own. Before saying anything about a specific batch id (data unavailable, no telemetry, sensors down, \
troubleshooting steps, etc.), you must have confirmed via get_running_batch_status or get_fleet_overview that \
the batch actually exists. If it does not exist, say plainly that it's not a currently running batch - do \
NOT speculate about instrumentation, sensors, PLC/historian connectivity, or invent any troubleshooting/SOP \
steps for a batch that isn't real. Every recommended action you state must be one the tools actually returned \
(e.g. an alert's recommended_action) - never a generic industrial-troubleshooting step you came up with yourself.

NEVER surface backend/API/tool mechanics to the user - no "I will fetch...", "API error", "backend error", \
tool names, or raw exception text. If something is genuinely unavailable (e.g. a batch has too little \
history yet, or a lookup failed), say so briefly and answer from whatever reliable data you do have - never \
leave the user with a technical error instead of an answer.

FORMATTING - this is formatting only, it never changes what you'd otherwise say or how much detail you'd \
give: wrap the genuinely important parts in **double asterisks** for bold - batch ids, Critical/Warning/ \
Normal status, KPI names, key numeric values, and recommended actions. Don't bold every sentence or common \
words - only the parts a reader's eye should actually land on. Use "- " bullet lines for a list of several \
items (batches, KPIs, alerts); use plain short paragraphs otherwise. These are the ONLY two formatting \
elements available - do not use markdown headings (#), tables, links, or code blocks, they will not render."""


# Requested for more deterministic answers. Some Azure deployments
# (reasoning-tier models in particular - same constraint app.live.llm_agent's
# own module docstring documents) reject any temperature value other than
# the default (1) and 400 the whole request. Attempted on every call unless/
# until that happens once, at which point this permanently falls back to the
# deployment's default for the rest of the process - checked once, not
# retried (and failed) on every subsequent call.
_TEMPERATURE = 0
_temperature_supported = True


def _create_completion(client, messages: list[dict]):
    global _temperature_supported
    kwargs = {'temperature': _TEMPERATURE} if _temperature_supported else {}
    try:
        return client.chat.completions.create(
            model=_AZURE_DEPLOYMENT, name='copilot-chat', messages=messages, tools=tools.TOOL_SCHEMAS, **kwargs,
        )
    except Exception as e:
        if _temperature_supported and 'temperature' in str(e).lower():
            logger.warning(
                'Azure deployment %s rejected temperature=%s - falling back to its default for the rest of '
                'this process.', _AZURE_DEPLOYMENT, _TEMPERATURE,
            )
            _temperature_supported = False
            return client.chat.completions.create(
                model=_AZURE_DEPLOYMENT, name='copilot-chat', messages=messages, tools=tools.TOOL_SCHEMAS,
            )
        raise


def _execute_tool_call(tc) -> dict:
    fn = tools.TOOL_DISPATCH.get(tc.function.name)
    started = time.perf_counter()
    try:
        args = json.loads(tc.function.arguments or '{}')
        # Never put raw exception text into the model's context - it's
        # internal (stack traces, SQL errors, etc.), and the model
        # would otherwise have a natural tendency to relay it verbatim
        # to the user. A plain "unavailable" signal is enough for the
        # model to say so and move on with whatever else it has.
        return fn(**args) if fn else {'unavailable': True}
    except Exception:
        logger.exception('AI Copilot tool call failed: %s', tc.function.name)
        return {'unavailable': True}
    finally:
        logger.info('AI Copilot tool %s took %.0fms', tc.function.name, (time.perf_counter() - started) * 1000)


def _run_tool_loop(messages: list[dict]) -> str | None:
    client = _get_client()
    if client is None:
        return None

    for round_num in range(1, MAX_TOOL_ROUNDS + 1):
        llm_started = time.perf_counter()
        response = _create_completion(client, messages)
        logger.info('AI Copilot round %d LLM call took %.0fms', round_num, (time.perf_counter() - llm_started) * 1000)
        message = response.choices[0].message
        if not message.tool_calls:
            return message.content

        messages.append({
            'role': 'assistant',
            'content': message.content,
            'tool_calls': [
                {'id': tc.id, 'type': 'function', 'function': {'name': tc.function.name, 'arguments': tc.function.arguments}}
                for tc in message.tool_calls
            ],
        })
        tools_started = time.perf_counter()
        if len(message.tool_calls) == 1:
            results = [_execute_tool_call(message.tool_calls[0])]
        else:
            # Independent tool calls the model already decided to make in
            # this same turn - executing them concurrently only changes how
            # long this round takes, never what's called or what comes back,
            # so it can't affect answer content/format/tool-selection.
            with ThreadPoolExecutor(max_workers=len(message.tool_calls)) as pool:
                results = list(pool.map(_execute_tool_call, message.tool_calls))
        logger.info(
            'AI Copilot round %d: %d tool call(s) took %.0fms total',
            round_num, len(message.tool_calls), (time.perf_counter() - tools_started) * 1000,
        )
        for tc, result in zip(message.tool_calls, results):
            messages.append({'role': 'tool', 'tool_call_id': tc.id, 'content': json.dumps(result, default=str)})

    return "I wasn't able to finish looking that up - try asking about one specific batch, or rephrase the question."


def generate_reply(persona: str, history: list[dict], message: str, running_batch_id: str | None) -> str:
    messages = [{'role': 'system', 'content': _system_prompt(persona, running_batch_id)}, *history, {'role': 'user', 'content': message}]
    started = time.perf_counter()
    try:
        reply = _run_tool_loop(messages)
        return reply or UNAVAILABLE_MESSAGE
    except Exception:
        logger.exception('Azure OpenAI call failed for the AI Copilot.')
        return UNAVAILABLE_MESSAGE
    finally:
        logger.info('AI Copilot query %r took %.0fms total', message[:60], (time.perf_counter() - started) * 1000)
