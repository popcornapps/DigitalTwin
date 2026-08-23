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


async def stream_chat_message(conv_id: str, persona: str, running_batch_id: str | None, message: str):
    """Streaming counterpart to handle_chat_message - same lookup of prior
    history and same persistence of the finished turn, just yields the
    reply in pieces as llm_agent.stream_reply generates them instead of
    returning it once complete."""
    history = conversation_store.get_history(conv_id)
    full_reply_parts = []
    async for piece in llm_agent.stream_reply(persona, history, message, running_batch_id):
        full_reply_parts.append(piece)
        yield piece
    conversation_store.append_turn(conv_id, message, ''.join(full_reply_parts))
