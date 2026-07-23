// Client for the FastAPI backend (backend/app) - replaces the old static
// deviationPredictionSnapshot.ts data source with live model-driven calls.
const API_BASE_URL = 'http://localhost:8000/api';

export class ApiError extends Error {}

async function fetchJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`);
  } catch {
    throw new ApiError('Could not reach the prediction API. Is the backend running? (.venv/bin/uvicorn app.main:app --port 8000, from backend/)');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(body?.detail || `Request failed (${response.status})`);
  }

  return response.json();
}

export interface ValidTimeRange {
  min_elapsed_minutes: number;
  max_elapsed_minutes: number;
}

export interface BatchSummary {
  batch_id: string;
  plant: string;
  product: string;
  ground_truth_scenario: string;
  ground_truth_severity: string;
  batch_duration_minutes: number;
  batch_start_datetime: string;
  valid_time_range: ValidTimeRange;
}

export interface ParameterPrediction {
  key: string;
  label: string;
  unit: string;
  applicable: boolean;
  current: number;
  predicted: number | null;
  ci_low: number | null;
  ci_high: number | null;
  lower_limit: number;
  upper_limit: number;
  alert_level: 'Normal' | 'Warning' | 'Critical' | 'Not Applicable';
  actual: number | null;
  error: number | null;
  correctness: 'Correct catch' | 'Correct quiet' | 'Missed' | 'False alarm' | null;
}

export interface PredictionResponse {
  batch_id: string;
  elapsed_minutes: number;
  horizon_minutes: number;
  parameters: ParameterPrediction[];
}

export interface TimelinePoint {
  elapsed_minutes: number;
  temperature: number;
  process_pressure: number;
  flow_rate: number;
  agitator_rpm: number;
}

export interface TimelineResponse {
  batch_id: string;
  batch_duration_minutes: number;
  points: TimelinePoint[];
}

export interface ParameterConfigEntry {
  key: string;
  label: string;
  unit: string;
  lower_limit: number;
  upper_limit: number;
}

export interface BatchKPIs {
  batch_id: string;
  cycle_time_hrs: number;
  process_stability_pct: number;
  process_stability_in_control_pct_temperature: number;
  process_stability_in_control_pct_process_pressure: number;
  process_stability_in_control_pct_flow_rate: number;
  golden_batch_similarity_pct: number;
  golden_batch_similarity_pct_temperature: number;
  golden_batch_similarity_pct_process_pressure: number;
  golden_batch_similarity_pct_flow_rate: number;
  fault_onset_elapsed_minutes: number | null;
  yield_pct: number;
  quality_score_pct: number;
  oee_availability_pct: number;
  oee_performance_pct: number;
  oee_quality_pct: number;
  oee_pct: number;
  total_energy_kwh: number;
  sec_kwh_per_kg: number;
  generation_method_version: string;
}

export interface PlantKpiRollup {
  plant: string;
  batch_count: number;
  oee_pct: number;
  quality_score_pct: number;
  process_stability_pct: number;
  plant_performance_pct: number;
}

export const fetchBatches = (scope: 'test' | 'all' = 'test'): Promise<BatchSummary[]> =>
  fetchJson(`/batches?scope=${scope}`);

export const fetchBatchSummary = (batchId: string): Promise<BatchSummary> =>
  fetchJson(`/batches/${encodeURIComponent(batchId)}`);

export const fetchTimeline = (batchId: string): Promise<TimelineResponse> =>
  fetchJson(`/batches/${encodeURIComponent(batchId)}/timeline`);

export const fetchParameterConfig = (): Promise<ParameterConfigEntry[]> => fetchJson('/parameters/config');

export const fetchPrediction = (batchId: string, at: number): Promise<PredictionResponse> =>
  fetchJson(`/batches/${encodeURIComponent(batchId)}/predict?at=${at}`);

export const fetchBatchKPIs = (batchId: string): Promise<BatchKPIs> =>
  fetchJson(`/batch-kpis/${encodeURIComponent(batchId)}`);

export const fetchAllBatchKPIs = (): Promise<BatchKPIs[]> => fetchJson('/batch-kpis');

export const fetchPlantKpiRollup = (plant: string): Promise<PlantKpiRollup> =>
  fetchJson(`/batch-kpis/rollup?plant=${encodeURIComponent(plant)}`);

export const GOLDEN_BATCH_ID = 'PAR-GOLDEN';
