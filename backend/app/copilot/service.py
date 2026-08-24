"""Public API for the AI Copilot - the only module app.routers.copilot should
import from, matching the convention app.live.service already documents for
the live-batch subsystem."""
from app.copilot import conversation_store, llm_agent


def handle_chat_message(conversation_id: str | None, persona: str, running_batch_id: str | None, message: str) -> dict:
    conv_id = conversation_id or conversation_store.new_conversation_id()
    history = conversation_store.get_history(conv_id)
    reply = llm_agent.generate_reply(persona, history, message, running_batch_id)
    conversation_store.append_turn(conv_id, message, reply)
    return {'reply': reply, 'conversation_id': conv_id}


def resolve_conversation_id(conversation_id: str | None) -> str:
    """Split out from stream_chat_message so the router can know the
    conversation_id (e.g. to send it as a response header) before the
    streaming response body starts, rather than only at the end the way
    the non-streaming handle_chat_message's return value works."""
    return conversation_id or conversation_store.new_conversation_id()


# How many user+AI EXCHANGES (a question and its answer, 2 raw entries each)
# from the client-supplied history (see stream_chat_message) actually get
# sent to the LLM - a plain truncation, no summarization and no extra LLM
# call. Deliberately small and fixed rather than derived from
# conversation_store's own TTL: the client's copy of the conversation
# (what's still visible in the chat UI) doesn't expire the way
# conversation_store's server-side copy does, so this is what makes a
# returning-after-a-long-gap user still get real context instead of a
# silently-forgotten chat - see app.schemas.copilot.CopilotChatRequest.history.
HISTORY_EXCHANGE_LIMIT = 5
HISTORY_TURN_LIMIT = HISTORY_EXCHANGE_LIMIT * 2


async def stream_chat_message(
    conv_id: str, persona: str, running_batch_id: str | None, message: str, client_history: list[dict],
):
    """Streaming counterpart to handle_chat_message - same persistence of
    the finished turn, just yields the reply in pieces as
    llm_agent.stream_reply generates them instead of returning it once
    complete.

    Unlike handle_chat_message (which reads conversation_store's own
    server-side history - silently empty once CONVERSATION_TTL_SECONDS of
    inactivity has passed), this uses the CLIENT-supplied history instead -
    truncated to the latest HISTORY_EXCHANGE_LIMIT exchanges, regardless of how many
    the client sent or how long it's been since the last message. Everything
    else (the agent, its tools, the system prompt) is unaffected by this -
    llm_agent.stream_reply already accepts a plain history list in this
    exact {'role', 'content'} shape."""
    history = client_history[-HISTORY_TURN_LIMIT:]
    full_reply_parts = []
    async for piece in llm_agent.stream_reply(persona, history, message, running_batch_id):
        full_reply_parts.append(piece)
        yield piece
    conversation_store.append_turn(conv_id, message, ''.join(full_reply_parts))
