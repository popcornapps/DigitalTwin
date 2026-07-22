from pydantic import BaseModel


class TimelinePoint(BaseModel):
    elapsed_minutes: int
    temperature: float
    process_pressure: float
    flow_rate: float
    agitator_rpm: float


class TimelineResponse(BaseModel):
    batch_id: str
    batch_duration_minutes: int
    points: list[TimelinePoint]
