import os
import secrets

import msal
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse

from app import session_store
from app.auth import SESSION_COOKIE_NAME, get_current_user

load_dotenv()

ENTRA_TENANT_ID = os.environ.get('ENTRA_TENANT_ID', '')
ENTRA_CLIENT_ID = os.environ.get('ENTRA_CLIENT_ID', '')
ENTRA_CLIENT_SECRET = os.environ.get('ENTRA_CLIENT_SECRET', '')
ENTRA_REDIRECT_URI = os.environ.get('ENTRA_REDIRECT_URI', 'http://localhost:8000/api/auth/callback')
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:5173')
COOKIE_SECURE = os.environ.get('COOKIE_SECURE', 'false').lower() == 'true'
SESSION_TTL_SECONDS = session_store.SESSION_TTL_SECONDS

OAUTH_STATE_COOKIE_NAME = 'oauth_state'
SCOPES = ['User.Read']

router = APIRouter(prefix='/api/auth', tags=['auth'])

_msal_app = msal.ConfidentialClientApplication(
    ENTRA_CLIENT_ID,
    client_credential=ENTRA_CLIENT_SECRET,
    authority=f'https://login.microsoftonline.com/{ENTRA_TENANT_ID}',
)


@router.get('/login')
def login():
    state = secrets.token_urlsafe(24)
    auth_url = _msal_app.get_authorization_request_url(SCOPES, state=state, redirect_uri=ENTRA_REDIRECT_URI)
    response = RedirectResponse(auth_url)
    response.set_cookie(
        OAUTH_STATE_COOKIE_NAME, state, httponly=True, samesite='lax', secure=COOKIE_SECURE, max_age=600, path='/',
    )
    return response


@router.get('/callback')
def callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None):
    expected_state = request.cookies.get(OAUTH_STATE_COOKIE_NAME)

    if error or not code or not state or not expected_state or not secrets.compare_digest(state, expected_state):
        response = RedirectResponse(f'{FRONTEND_URL}/?login_error=1')
        response.delete_cookie(OAUTH_STATE_COOKIE_NAME, path='/')
        return response

    result = _msal_app.acquire_token_by_authorization_code(code, scopes=SCOPES, redirect_uri=ENTRA_REDIRECT_URI)
    if 'error' in result:
        response = RedirectResponse(f'{FRONTEND_URL}/?login_error=1')
        response.delete_cookie(OAUTH_STATE_COOKIE_NAME, path='/')
        return response

    id_token_claims = result.get('id_token_claims', {})
    session_id = session_store.create_session({
        'name': id_token_claims.get('name'),
        'email': id_token_claims.get('preferred_username'),
        'oid': id_token_claims.get('oid'),
    })

    response = RedirectResponse(FRONTEND_URL)
    response.delete_cookie(OAUTH_STATE_COOKIE_NAME, path='/')
    response.set_cookie(
        SESSION_COOKIE_NAME, session_id, httponly=True, samesite='lax', secure=COOKIE_SECURE,
        max_age=SESSION_TTL_SECONDS, path='/',
    )
    return response


@router.get('/me')
def me(user: dict = Depends(get_current_user)):
    return user


@router.get('/logout')
def logout(request: Request):
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if session_id:
        session_store.delete_session(session_id)

    logout_url = (
        f'https://login.microsoftonline.com/{ENTRA_TENANT_ID}/oauth2/v2.0/logout'
        f'?post_logout_redirect_uri={FRONTEND_URL}'
    )
    response = RedirectResponse(logout_url)
    response.delete_cookie(SESSION_COOKIE_NAME, path='/')
    return response
