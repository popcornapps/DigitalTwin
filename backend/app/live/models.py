from dataclasses import dataclass
from datetime import datetime


@dataclass
class LiveParameterPrediction:
    key: str
    predicted: float
    ci_low: float
    ci_high: float
    alert_level: str  # 'Normal' | 'Warning' | 'Critical' - from the unmodified classify_predicted()


@dataclass
class LivePrediction:
    horizon_minutes: int
    computed_at_elapsed_minutes: int
    # All 4 parameters, uniformly - no phase-aware exclusion of Agitator RPM
    # here, per the confirmed continuous-process design.
    parameters: list[LiveParameterPrediction]


@dataclass
class RunningBatch:
    running_batch_id: str
    plant: str
    product: str
    status: str  # 'Running' | 'Completed' | 'Stopped'
    scenario_profile: str  # 'Normal' | 'Warning' | 'Critical'
    drifting_parameter: str | None
    phase: str  # 'dispensing' | 'dry_mixing' | 'wet_massing' | 'transfer' | 'drying' | 'cooling' | 'complete'
    started_at: datetime
    elapsed_minutes: int
    target_duration_minutes: int
    # None until 30+ minutes of history exist; overwritten each tick, not a
    # history of past forecasts - only the current one matters.
    latest_prediction: LivePrediction | None = None


@dataclass
class TelemetryReading:
    running_batch_id: str
    elapsed_minutes: int
    recorded_at: datetime
    phase: str
    temperature: float
    process_pressure: float
    flow_rate: float
    agitator_rpm: float
