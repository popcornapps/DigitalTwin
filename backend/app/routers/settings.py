from fastapi import APIRouter, HTTPException

from app.live import ai_mode
from app.live import config as live_config
from app.schemas.settings import AIModeIn, AIModeOut, TickIntervalOut

router = APIRouter(prefix='/api/settings', tags=['settings'])


@router.get('/ai-mode', response_model=AIModeOut)
def get_ai_mode():
    return AIModeOut(mode=ai_mode.get_mode())


@router.post('/ai-mode', response_model=AIModeOut)
def set_ai_mode(req: AIModeIn):
    try:
        mode = ai_mode.set_mode(req.mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AIModeOut(mode=mode)


@router.get('/tick-interval', response_model=TickIntervalOut)
def get_tick_interval():
    return TickIntervalOut(tick_interval_seconds=live_config.TICK_INTERVAL_SECONDS)
