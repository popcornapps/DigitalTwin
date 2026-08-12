import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.auth import get_current_user
from app.config import CORS_ORIGINS
from app.live import scheduler as live_scheduler
from app.live import service as live_service
from app.routers import alerts, auth as auth_router, batch_kpis, batches, kpi_prediction, live_batches, parameters, settings
from app.state import app_state

# Populated only in the single-container Docker build (see Dockerfile), which
# copies the built frontend here - absent in local dev, where the frontend
# runs on its own Vite dev server instead.
STATIC_DIR = Path(__file__).resolve().parents[1] / 'static'


@asynccontextmanager
async def lifespan(_app: FastAPI):
    app_state.load()  # model (~400MB) + reference data loaded once, held for the process lifetime
    live_service.seed_default_batches()  # 4 default running batches, spread across old + new parameters
    tick_task = live_scheduler.start()
    yield
    tick_task.cancel()
    try:
        await tick_task
    except asyncio.CancelledError:
        pass


app = FastAPI(title='PharmaTwin Deviation Prediction API', lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    # POST endpoints that send a JSON body (e.g. AI mode toggle) trigger a
    # CORS preflight, unlike the existing no-body POSTs (acknowledge/reject/
    # stop) which qualify as "simple requests" and skip preflight entirely -
    # 'GET' alone let those slip through unnoticed until this one needed it.
    # 'DELETE' added for DELETE /api/live-batches/{id} - without it the
    # browser blocks the request at the CORS preflight, even though curl
    # (which doesn't enforce CORS) calls it fine.
    allow_methods=['GET', 'POST', 'DELETE'],
    allow_headers=['*'],
    # Defense-in-depth only, not what makes the session cookie work in dev -
    # the Vite dev-server proxy (frontend/vite.config.ts) makes the browser
    # see frontend+backend as one origin, so the real auth flow never
    # actually needs a cross-origin credentialed request. This just covers
    # anyone hitting the backend directly, bypassing the proxy.
    allow_credentials=True,
)

app.include_router(auth_router.router)

protected = [Depends(get_current_user)]

app.include_router(batches.router, dependencies=protected)
app.include_router(parameters.router, dependencies=protected)
app.include_router(batch_kpis.router, dependencies=protected)
app.include_router(live_batches.router, dependencies=protected)
app.include_router(alerts.router, dependencies=protected)
app.include_router(settings.router, dependencies=protected)
app.include_router(kpi_prediction.router, dependencies=protected)


@app.get('/api/health')
def health():
    return {'status': 'ok', 'model_loaded': app_state.model is not None, 'test_batches': len(app_state.test_batch_ids)}


if STATIC_DIR.is_dir():
    app.mount('/assets', StaticFiles(directory=STATIC_DIR / 'assets'), name='assets')

    # Catch-all for client-side routes (e.g. a hard refresh on /batch-explorer)
    # - React Router handles the path once index.html loads, so every
    # non-API, non-asset GET just gets served the same shell. Registered
    # last so it never shadows the /api/* routers or /assets above.
    @app.get('/{full_path:path}')
    def spa_shell(full_path: str):
        return FileResponse(STATIC_DIR / 'index.html')
