import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import CORS_ORIGINS
from app.live import scheduler as live_scheduler
from app.live import service as live_service
from app.routers import alerts, batch_kpis, batches, kpi_prediction, live_batches, parameters, settings
from app.state import app_state


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
)

app.include_router(batches.router)
app.include_router(parameters.router)
app.include_router(batch_kpis.router)
app.include_router(live_batches.router)
app.include_router(alerts.router)
app.include_router(settings.router)
app.include_router(kpi_prediction.router)


@app.get('/api/health')
def health():
    return {'status': 'ok', 'model_loaded': app_state.model is not None, 'test_batches': len(app_state.test_batch_ids)}
