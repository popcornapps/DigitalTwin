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

export const fetchBatches = (): Promise<BatchSummary[]> => fetchJson('/batches');

export const fetchPrediction = (batchId: string, at: number): Promise<PredictionResponse> =>
  fetchJson(`/batches/${encodeURIComponent(batchId)}/predict?at=${at}`);
