from pydantic import BaseModel


class BatchKPIs(BaseModel):
    batch_id: str
    cycle_time_hrs: float
    process_stability_pct: float
    process_stability_in_control_pct_temperature: float
    process_stability_in_control_pct_process_pressure: float
    process_stability_in_control_pct_flow_rate: float
    golden_batch_similarity_pct: float
    golden_batch_similarity_pct_temperature: float
    golden_batch_similarity_pct_process_pressure: float
    golden_batch_similarity_pct_flow_rate: float
    # None for batches that never left their control band (Normal batches, mostly) -
    # see the batch_kpis generation script for how this is back-derived.
    fault_onset_elapsed_minutes: float | None
    yield_pct: float
    quality_score_pct: float
    oee_availability_pct: float
    oee_performance_pct: float
    oee_quality_pct: float
    oee_pct: float
    total_energy_kwh: float
    sec_kwh_per_kg: float
    # Traces which generation pass produced this row - see
    # docs/batch-kpis-prediction-readiness-review.md for the full provenance
    # breakdown of every field above (real/derived/semi-derived/synthetic).
    generation_method_version: str


class PlantKpiRollup(BaseModel):
    plant: str
    batch_count: int
    oee_pct: float
    quality_score_pct: float
    process_stability_pct: float
    plant_performance_pct: float
