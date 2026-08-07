from pydantic import BaseModel


class ValidTimeRange(BaseModel):
    min_elapsed_minutes: int
    max_elapsed_minutes: int


class BatchSummary(BaseModel):
    batch_id: str
    plant: str
    product: str
    ground_truth_scenario: str
    ground_truth_severity: str
    batch_duration_minutes: int
    batch_start_datetime: str
    valid_time_range: ValidTimeRange
