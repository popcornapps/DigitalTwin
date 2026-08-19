"""In-process, in-memory chat history per conversation_id - same "lost on
restart, single-process only" tradeoff app.session_store already accepts for
auth sessions, for the same reason (nothing else in this codebase uses
external session/cache infra). Not wired into Postgres: chat history isn't
part of the durable analytics record the way alerts/batches are.
"""
import time
import uuid

_conversations: dict[str, dict] = {}

CONVERSATION_TTL_SECONDS = 3600  # 1 hour of inactivity


def new_conversation_id() -> str:
    return uuid.uuid4().hex


def get_history(conversation_id: str) -> list[dict]:
    convo = _conversations.get(conversation_id)
    if convo is None:
        return []
    if convo['expires_at'] < time.time():
        del _conversations[conversation_id]
        return []
    return convo['messages']


def append_turn(conversation_id: str, user_message: str, reply: str) -> None:
    messages = get_history(conversation_id) + [
        {'role': 'user', 'content': user_message},
        {'role': 'assistant', 'content': reply},
    ]
    _conversations[conversation_id] = {'messages': messages, 'expires_at': time.time() + CONVERSATION_TTL_SECONDS}
