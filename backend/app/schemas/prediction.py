from pydantic import BaseModel


class ParameterPrediction(BaseModel):
    key: str
    label: str
    unit: str
    applicable: bool
    current: float
    predicted: float | None
    ci_low: float | None
    ci_high: float | None
    lower_limit: float
    upper_limit: float
    alert_level: str
    actual: float | None
    error: float | None
    correctness: str | None


class PredictionResponse(BaseModel):
    batch_id: str
    elapsed_minutes: int
    horizon_minutes: int
    parameters: list[ParameterPrediction]
