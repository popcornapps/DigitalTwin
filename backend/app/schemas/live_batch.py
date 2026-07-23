from datetime import datetime

from pydantic import BaseModel


class RunningBatchSummary(BaseModel):
    running_batch_id: str
    plant: str
    product: str
    status: str
    scenario_profile: str
    drifting_parameter: str | None
    phase: str
    started_at: datetime
    elapsed_minutes: int
    target_duration_minutes: int


class TelemetryReadingOut(BaseModel):
    elapsed_minutes: int
    recorded_at: datetime
    phase: str
    temperature: float
    process_pressure: float
    flow_rate: float
    agitator_rpm: float


class LiveParameterPredictionOut(BaseModel):
    key: str
    predicted: float
    ci_low: float
    ci_high: float
    alert_level: str


class LivePredictionOut(BaseModel):
    horizon_minutes: int
    computed_at_elapsed_minutes: int
    parameters: list[LiveParameterPredictionOut]


class RunningBatchTelemetryResponse(BaseModel):
    batch: RunningBatchSummary
    points: list[TelemetryReadingOut]
    # None until 30+ minutes of history exist for this batch - no fabricated
    # placeholder forecast in that window, per the design's honesty rule.
    prediction: LivePredictionOut | None = None


class CreateRunningBatchRequest(BaseModel):
    plant: str
    scenario_profile: str = 'Normal'
    drifting_parameter: str | None = None
