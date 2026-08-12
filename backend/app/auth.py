import os

from dotenv import load_dotenv
from fastapi import HTTPException, Request, status

from app import session_store

load_dotenv()

SESSION_COOKIE_NAME = os.environ.get('SESSION_COOKIE_NAME', 'dt_session')


def get_current_user(request: Request) -> dict:
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Not authenticated')
    claims = session_store.get_session(session_id)
    if claims is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Session expired or invalid')
    return claims
