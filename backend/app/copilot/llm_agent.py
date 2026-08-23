"""The AI Copilot's conversational reasoning layer - unlike app.live.llm_agent
and app.live.kpi_llm_agent (single-shot, structured-output "explain this
already-computed fact" calls), this runs a multi-turn tool-calling loop: the
model decides which app.copilot.tools functions to call, reads their results,
and keeps going until it has enough to answer in plain language. Implemented
on top of LangChain's create_agent (a LangGraph tool-calling loop under the
hood) rather than a hand-written round-trip loop - same tools, same prompt,
same fallback behavior, just LangChain running the loop instead of this
module doing so directly.

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
import logging
import os
import time

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import AzureChatOpenAI
from langgraph.errors import GraphRecursionError

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
# looping indefinitely on a confused conversation. LangGraph's create_agent
# loop takes 2 graph steps per round (one to call the model, one to run
# whatever tools it asked for) plus 1 final model step to produce the answer
# once it stops calling tools - recursion_limit is a step count, not a round
# count, so it must be set higher than MAX_TOOL_ROUNDS itself to actually
# allow that many real round-trips.
MAX_TOOL_ROUNDS = 3
_RECURSION_LIMIT = MAX_TOOL_ROUNDS * 2 + 1

_TOOL_ROUNDS_EXHAUSTED_MESSAGE = (
    "I wasn't able to finish looking that up - try asking about one specific batch, or rephrase the question."
)

_agent = None
_agent_init_attempted = False

# Requested for more deterministic answers. Some Azure deployments
# (reasoning-tier models in particular - same constraint app.live.llm_agent's
# own module docstring documents) reject any temperature value other than
# the default (1) and 400 the whole request. Attempted on first use unless/
# until that happens once, at which point this permanently falls back to the
# deployment's default for the rest of the process - checked once, not
# retried (and failed) on every subsequent call.
_TEMPERATURE = 0
_temperature_supported = True


def _build_agent(temperature_supported: bool):
    from langchain.agents import create_agent

    kwargs = {'temperature': _TEMPERATURE} if temperature_supported else {}
    llm = AzureChatOpenAI(
        azure_endpoint=_AZURE_ENDPOINT,
        api_key=_AZURE_API_KEY,
        api_version=_AZURE_API_VERSION,
        azure_deployment=_AZURE_DEPLOYMENT,
        **kwargs,
    )
    # debug=True prints each step (model call, tool call + args, tool
    # result) to the backend logs - a scratchpad for inspecting what the
    # agent actually did on its way to the final answer.
    return create_agent(model=llm, tools=tools.LANGCHAIN_TOOLS)


def _get_agent():
    """Lazy singleton - same reasoning as app.live.llm_agent._get_client."""
    global _agent, _agent_init_attempted
    if _agent_init_attempted:
        return _agent
    _agent_init_attempted = True
    if not (_AZURE_ENDPOINT and _AZURE_API_KEY and _AZURE_DEPLOYMENT):
        logger.warning('Azure OpenAI not configured - the AI Copilot cannot answer questions.')
        return None
    try:
        _agent = _build_agent(_temperature_supported)
    except Exception:
        logger.exception('Failed to construct the AI Copilot LangChain agent.')
        _agent = None
    return _agent


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

HOW TO THINK ABOUT EVERY QUESTION - figure out what the person actually wants, then answer that directly; the \
right length, structure, and data all depend on genuine judgment about intent, not a template keyed to question \
phrasing:
- Match LENGTH and SCOPE to the actual question. A question about ONE specific thing gets an answer about ONLY \
that thing - name it, give the one-line reason, give the action if relevant, then STOP. Don't add other \
batches "for context" unless the question was about comparing/listing multiple things.
- Distinguish SUMMARY intent (general state, overview, what's running, anything needing attention) from \
DETAIL/DIAGNOSTIC intent (a specific issue, its cause, what to do, or an explicit "why/what caused/what should \
I do/show me the alerts/telemetry/details"). SUMMARY gets a brief per-batch status line only (id + severity, \
plus a one-line flag of whichever needs attention most if severities differ) - never the alert text, \
recommended actions, root causes, KPI numbers, or alert IDs behind it, and never more detail per batch just \
because more batches are covered. DETAIL/DIAGNOSTIC is when root causes, recommended actions, and specific \
numbers belong in the answer, scoped to what's actually asked. Never restate detail already given earlier in \
this conversation just because it's available.
- Don't end with an offer to fetch more ("do you want me to pull...") unless the question itself was \
open-ended/exploratory - if it had a specific, answerable target and you answered it, stop there.
- Lead with whatever is riskier or more urgent than the rest of what's relevant - the person almost always \
cares about it most, whether or not they asked for a ranking.
- Cover what's happening, why, and what to do, as a natural answer - not forced labeled sections every time; \
skip whatever doesn't apply.
- Default to CURRENT/running batches; bring in historical or golden-batch data only when asked for a \
comparison/history or when it genuinely helps.
- Don't ask the user to specify a batch if what's already available (an overview you have, the conversation so \
far, or the batch they were viewing) already answers it.

TOOL USE - be economical, every call is a real round-trip: get_fleet_overview covers status, condensed KPI \
status, and top alerts for every running batch at once - reach for it before looping single-batch tools \
(get_running_batch_status, get_latest_kpi_prediction, get_latest_parameter_assessments, get_active_alerts) one \
by one. Only call get_recent_telemetry, or ask for full alert/historical detail, when genuinely needed. Calling \
a single-batch tool once for one running_batch_id is never a reason to skip calling it again for a DIFFERENT \
running_batch_id - a question spanning multiple batches needs that tool once per batch; never answer for a \
second/third batch by guessing or reusing another batch's numbers. Two batches CAN legitimately show the same \
or similar values (e.g. early in a run) - if that's genuinely what each batch's own call returned, say so \
plainly; never fabricate a difference to seem more plausible.

ALERT IDs FOR KPI ISSUES: get_latest_kpi_prediction NEVER includes an alert_id, even for a KPI with a real open \
alert - it's a live ML snapshot, not the alert record. Its per-KPI "key" (e.g. "sec_kwh_per_kg") equals the \
"parameter" field on a KPI-sourced entry from get_active_alerts or get_fleet_overview's top_alerts. Before \
citing an alert ID for a KPI issue, or saying one isn't available, you must have actually called \
get_active_alerts (or already have it from get_fleet_overview) and checked for a matching "parameter" - never \
conclude "no alert ID" just because get_latest_kpi_prediction lacks one, and never state severity/status from \
get_latest_kpi_prediction when get_active_alerts has a matching, more authoritative entry.

LIVE DATA: parameters, KPI predictions, and alerts change tick to tick - speak from the latest data, not as \
permanent fact. If several factors are involved, name the current primary driver distinctly from secondary \
ones, in one sentence, not an unranked list.

STRICT GROUNDING - overrides fluency or completeness: every fact, number, status, or claim must come from a \
tool result already in THIS conversation (the most recent call for anything that can change - don't reuse a \
stale value once a fresher one exists). Use the recommendations/root causes the tools already give you (from \
the KPI Prediction and Deviation Agents) - never invent your own diagnosis, a batch id, a value, or a \
recommendation. If you're not fully sure a claim is backed by a tool result already in this conversation, call \
the tool again rather than guess, or say you don't have that information.

UNKNOWN BATCH vs NO DATA YET - not the same thing. get_running_batch_status returns null ONLY when the batch \
id genuinely doesn't exist. get_recent_telemetry returns an EMPTY LIST for BOTH an unknown id and a real batch \
with no readings yet - it can't tell them apart. Before saying anything about a specific batch (data \
unavailable, no telemetry, sensors down, troubleshooting, etc.), confirm via get_running_batch_status or \
get_fleet_overview that it actually exists. If it doesn't, say so plainly - don't speculate about \
instrumentation/sensors/connectivity or invent troubleshooting steps for a batch that isn't real. Every \
recommended action must be one the tools actually returned - never a generic step you came up with.

NEVER surface backend/API/tool mechanics - no "I will fetch...", "API error", tool names, or raw exception \
text. If something's genuinely unavailable, say so briefly and answer from whatever reliable data you do have \
- never leave the user with a technical error instead of an answer.

FORMATTING (formatting only, never changes content or detail): **bold** the genuinely important parts - batch \
ids, Critical/Warning/Normal status, KPI names, key numbers, recommended actions - not every sentence. Use \
"- " bullets for a list of several items; plain short paragraphs otherwise. No markdown headings, tables, \
links, or code blocks - they won't render."""


def _langfuse_handler(conversation_id: str | None):
    """Best-effort - if Langfuse itself isn't reachable/configured, tracing is
    just skipped, never a reason to fail the actual chat request."""
    try:
        from langfuse.langchain import CallbackHandler
        if conversation_id:
            from langfuse import get_client
            trace_id = get_client().create_trace_id(seed=conversation_id)
            return CallbackHandler(trace_context={'trace_id': trace_id})
        return CallbackHandler()
    except Exception:
        logger.exception('Failed to construct Langfuse callback handler for the AI Copilot.')
        return None


def _invoke_config(conversation_id: str | None) -> dict:
    config = {'recursion_limit': _RECURSION_LIMIT, 'run_name': 'copilot-chat'}
    handler = _langfuse_handler(conversation_id)
    if handler is not None:
        config['callbacks'] = [handler]
    return config


def _run_agent(messages: list, conversation_id: str | None) -> str | None:
    global _temperature_supported, _agent

    agent = _get_agent()
    if agent is None:
        return None

    config = _invoke_config(conversation_id)
    try:
        result = agent.invoke({'messages': messages}, config=config)
    except GraphRecursionError:
        return _TOOL_ROUNDS_EXHAUSTED_MESSAGE
    except Exception as e:
        if _temperature_supported and 'temperature' in str(e).lower():
            logger.warning(
                'Azure deployment %s rejected temperature=%s - falling back to its default for the rest of '
                'this process.', _AZURE_DEPLOYMENT, _TEMPERATURE,
            )
            _temperature_supported = False
            _agent = _build_agent(False)
            try:
                result = _agent.invoke({'messages': messages}, config=config)
            except GraphRecursionError:
                return _TOOL_ROUNDS_EXHAUSTED_MESSAGE
        else:
            raise

    final_message = result['messages'][-1]
    return final_message.content if isinstance(final_message, AIMessage) else None


def generate_reply(persona: str, history: list[dict], message: str, running_batch_id: str | None) -> str:
    messages = [SystemMessage(content=_system_prompt(persona, running_batch_id))]
    for turn in history:
        cls = HumanMessage if turn['role'] == 'user' else AIMessage
        messages.append(cls(content=turn['content']))
    messages.append(HumanMessage(content=message))

    started = time.perf_counter()
    try:
        reply = _run_agent(messages, running_batch_id)
        return reply or UNAVAILABLE_MESSAGE
    except Exception:
        logger.exception('Azure OpenAI call failed for the AI Copilot.')
        return UNAVAILABLE_MESSAGE
    finally:
        logger.info('AI Copilot query %r took %.0fms total', message[:60], (time.perf_counter() - started) * 1000)


async def _astream_agent(messages: list, conversation_id: str | None):
    """Streaming counterpart to _run_agent - same agent, same tools, same
    prompt, same temperature-fallback and recursion-limit handling, only
    yields the final answer's text piece by piece as the model generates it
    instead of returning the whole string once generation is complete.
    Filtering on `chunk.content` truthiness is deliberate and sufficient:
    verified empirically that the tool-call-deciding round's chunks always
    carry empty content (the tool call itself streams separately, not as
    text), so this naturally streams only the real, final, user-facing
    answer - never a tool-call round's internal chatter."""
    global _temperature_supported, _agent

    agent = _get_agent()
    if agent is None:
        return

    config = _invoke_config(conversation_id)

    async def _stream(active_agent):
        async for chunk, _metadata in active_agent.astream(
            {'messages': messages}, config=config, stream_mode='messages',
        ):
            if isinstance(chunk, AIMessage) and chunk.content:
                yield chunk.content

    try:
        async for piece in _stream(agent):
            yield piece
    except GraphRecursionError:
        yield _TOOL_ROUNDS_EXHAUSTED_MESSAGE
    except Exception as e:
        if _temperature_supported and 'temperature' in str(e).lower():
            logger.warning(
                'Azure deployment %s rejected temperature=%s - falling back to its default for the rest of '
                'this process.', _AZURE_DEPLOYMENT, _TEMPERATURE,
            )
            _temperature_supported = False
            _agent = _build_agent(False)
            try:
                async for piece in _stream(_agent):
                    yield piece
            except GraphRecursionError:
                yield _TOOL_ROUNDS_EXHAUSTED_MESSAGE
        else:
            raise


async def stream_reply(persona: str, history: list[dict], message: str, running_batch_id: str | None):
    """Same contract as generate_reply, streamed: yields the answer in
    pieces as they're generated instead of returning it as one string once
    finished. Always yields at least one piece (UNAVAILABLE_MESSAGE if
    nothing else came through, same fallback generate_reply uses) - a
    caller that concatenates every yielded piece gets exactly the string
    generate_reply would have returned for the same inputs."""
    messages = [SystemMessage(content=_system_prompt(persona, running_batch_id))]
    for turn in history:
        cls = HumanMessage if turn['role'] == 'user' else AIMessage
        messages.append(cls(content=turn['content']))
    messages.append(HumanMessage(content=message))

    started = time.perf_counter()
    yielded_anything = False
    try:
        async for piece in _astream_agent(messages, running_batch_id):
            yielded_anything = True
            yield piece
        if not yielded_anything:
            yield UNAVAILABLE_MESSAGE
    except Exception:
        logger.exception('Azure OpenAI call failed for the AI Copilot.')
        if not yielded_anything:
            yield UNAVAILABLE_MESSAGE
    finally:
        logger.info(
            'AI Copilot query %r took %.0fms total (streamed)', message[:60], (time.perf_counter() - started) * 1000,
        )
