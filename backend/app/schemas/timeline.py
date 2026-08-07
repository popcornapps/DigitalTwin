from pydantic import BaseModel


class TimelinePoint(BaseModel):
    elapsed_minutes: int
    temperature: float
    process_pressure: float
    flow_rate: float
    agitator_rpm: float
    inlet_air_humidity: float
    exhaust_air_temp: float
    filter_differential_pressure: float
    shaker_vibration_frequency: float
    product_bed_temp: float
    chamber_differential_pressure: float
    ahu_damper_position: float
    compressed_air_pressure: float


class TimelineResponse(BaseModel):
    batch_id: str
    batch_duration_minutes: int
    points: list[TimelinePoint]
