from pydantic import BaseModel


class AIModeOut(BaseModel):
    mode: str  # 'static' | 'agent_llm'


class AIModeIn(BaseModel):
    mode: str


class TickIntervalOut(BaseModel):
    # Real seconds of wall-clock time per simulated minute (see
    # app.live.config.TICK_INTERVAL_SECONDS) - exposed so the frontend can
    # display the actual live-update cadence instead of a hardcoded, driftable
    # duplicate of this same number.
    tick_interval_seconds: float
