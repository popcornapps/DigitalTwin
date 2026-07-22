from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import CORS_ORIGINS
from app.routers import batches, parameters, predictions
from app.state import app_state


@asynccontextmanager
async def lifespan(_app: FastAPI):
    app_state.load()  # model (~400MB) + reference data loaded once, held for the process lifetime
    yield


app = FastAPI(title='PharmaTwin Deviation Prediction API', lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=['GET'],
    allow_headers=['*'],
)

app.include_router(batches.router)
app.include_router(predictions.router)
app.include_router(parameters.router)


@app.get('/api/health')
def health():
    return {'status': 'ok', 'model_loaded': app_state.model is not None, 'test_batches': len(app_state.test_batch_ids)}
