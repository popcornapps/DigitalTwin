import os
import secrets
import time

# In-process, in-memory session store. All sessions are lost on backend
# restart, and this will NOT work correctly with `uvicorn --workers > 1` or
# multiple replicas - each process has its own dict, so a session created by
# one worker is invisible to another. Accepted for this single-process POC;
# not solving with Redis/etc since nothing else in this codebase uses
# external session infra.
_sessions: dict[str, dict] = {}

SESSION_TTL_SECONDS = int(float(os.environ.get('SESSION_TTL_HOURS', '8')) * 3600)


def create_session(claims: dict) -> str:
    session_id = secrets.token_urlsafe(32)
    _sessions[session_id] = {'claims': claims, 'expires_at': time.time() + SESSION_TTL_SECONDS}
    return session_id


def get_session(session_id: str) -> dict | None:
    session = _sessions.get(session_id)
    if session is None:
        return None
    if session['expires_at'] < time.time():
        del _sessions[session_id]
        return None
    return session['claims']


def delete_session(session_id: str) -> None:
    _sessions.pop(session_id, None)
