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
