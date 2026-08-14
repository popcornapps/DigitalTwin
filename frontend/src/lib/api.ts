// Client for the FastAPI backend (backend/app) - replaces the old static
// deviationPredictionSnapshot.ts data source with live model-driven calls.

// Falls back to the local-dev default if VITE_API_BASE_URL isn't set (e.g.
// a checkout without a .env yet) - see .env.example.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export class ApiError extends Error {}

// Every route under API_BASE_URL is gated by a session cookie on the
// backend (app/main.py, app/auth.py) - 'include' sends it along.
async function fetchJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include' });
  } catch {
    throw new ApiError('Could not reach the prediction API. Is the backend running? (.venv/bin/uvicorn app.main:app --port 8000, from backend/)');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(body?.detail || `Request failed (${response.status})`);
  }

  return response.json();
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Could not reach the prediction API. Is the backend running? (.venv/bin/uvicorn app.main:app --port 8000, from backend/)');
  }

  if (!response.ok) {
    const body2 = await response.json().catch(() => null);
    throw new ApiError(body2?.detail || `Request failed (${response.status})`);
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

export interface TimelinePoint {
  elapsed_minutes: number;
  temperature: number;
  process_pressure: number;
  flow_rate: number;
  agitator_rpm: number;
  inlet_air_humidity: number;
  exhaust_air_temp: number;
  filter_differential_pressure: number;
  shaker_vibration_frequency: number;
  product_bed_temp: number;
  chamber_differential_pressure: number;
  ahu_damper_position: number;
  compressed_air_pressure: number;
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
  theoretical_output_kg: number;
  actual_output_kg: number;
  assay_pct: number;
  yield_pct: number;
  quality_score_pct: number;
  oee_availability_pct: number;
  oee_performance_pct: number;
  oee_quality_pct: number;
  oee_pct: number;
  total_energy_kwh: number;
  sec_kwh_per_kg: number;
  generation_method_version: string;
  // ML KPI Prediction Agent's last-tick guess, captured at completion for
  // comparison against the real values above - null for historical batches
  // (e.g. PAR-119), which never ran through the live simulator.
  predicted_yield_pct: number | null;
  predicted_quality_score_pct: number | null;
  predicted_sec_kwh_per_kg: number | null;
  predicted_oee_pct: number | null;
  predicted_total_energy_kwh: number | null;
}

export interface PlantKpiRollup {
  plant: string;
  batch_count: number;
  oee_pct: number;
  quality_score_pct: number;
  process_stability_pct: number;
  plant_performance_pct: number;
  total_energy_consumption_kwh: number;
}

export type PlantPeriodGroupBy = 'shift' | 'day' | 'month';

export interface PlantPeriodKpi {
  plant: string;
  group_by: PlantPeriodGroupBy;
  period_label: string;
  period_start: string;
  batch_count: number;
  energy_consumption_kwh: number;
  total_production_kg: number;
  oee_pct: number;
  quality_score_pct: number;
}

export interface PlantPeriodKpiList {
  plant: string;
  group_by: PlantPeriodGroupBy;
  periods: PlantPeriodKpi[];
}

export const fetchBatches = (scope: 'test' | 'all' = 'test'): Promise<BatchSummary[]> =>
  fetchJson(`/batches?scope=${scope}`);

export const fetchBatchSummary = (batchId: string): Promise<BatchSummary> =>
  fetchJson(`/batches/${encodeURIComponent(batchId)}`);

export const fetchTimeline = (batchId: string): Promise<TimelineResponse> =>
  fetchJson(`/batches/${encodeURIComponent(batchId)}/timeline`);

export const fetchParameterConfig = (): Promise<ParameterConfigEntry[]> => fetchJson('/parameters/config');

// Per-minute deviation envelope derived from real Normal historical batches
// vs the golden batch - Golden(t) +/- offset(t), replacing the fixed
// parameter_config band as the basis for deviation status.
export interface GoldenEnvelopePoint {
  elapsed_minutes: number;
  temperature_lower_offset: number;
  temperature_upper_offset: number;
  process_pressure_lower_offset: number;
  process_pressure_upper_offset: number;
  flow_rate_lower_offset: number;
  flow_rate_upper_offset: number;
  agitator_rpm_lower_offset: number;
  agitator_rpm_upper_offset: number;
  inlet_air_humidity_lower_offset: number;
  inlet_air_humidity_upper_offset: number;
  exhaust_air_temp_lower_offset: number;
  exhaust_air_temp_upper_offset: number;
  filter_differential_pressure_lower_offset: number;
  filter_differential_pressure_upper_offset: number;
  shaker_vibration_frequency_lower_offset: number;
  shaker_vibration_frequency_upper_offset: number;
  product_bed_temp_lower_offset: number;
  product_bed_temp_upper_offset: number;
  chamber_differential_pressure_lower_offset: number;
  chamber_differential_pressure_upper_offset: number;
  ahu_damper_position_lower_offset: number;
  ahu_damper_position_upper_offset: number;
  compressed_air_pressure_lower_offset: number;
  compressed_air_pressure_upper_offset: number;
}

export const fetchGoldenEnvelope = (): Promise<GoldenEnvelopePoint[]> => fetchJson('/parameters/envelope');

export const fetchBatchKPIs = (batchId: string): Promise<BatchKPIs> =>
  fetchJson(`/batch-kpis/${encodeURIComponent(batchId)}`);

export const fetchAllBatchKPIs = (): Promise<BatchKPIs[]> => fetchJson('/batch-kpis');

export const fetchPlantKpiRollup = (plant: string): Promise<PlantKpiRollup> =>
  fetchJson(`/batch-kpis/rollup?plant=${encodeURIComponent(plant)}`);

export const fetchPlantPeriodKpis = (plant: string, groupBy: PlantPeriodGroupBy): Promise<PlantPeriodKpiList> =>
  fetchJson(`/batch-kpis/plant-period-kpis?plant=${encodeURIComponent(plant)}&group_by=${groupBy}`);

// Resolves the REAL current shift/day/month (server clock) - zero-valued if
// nothing has completed in that exact period yet, rather than falling back
// to whichever period happens to be latest in the data.
export const fetchPlantCurrentPeriodKpi = (plant: string, groupBy: PlantPeriodGroupBy): Promise<PlantPeriodKpi> =>
  fetchJson(`/batch-kpis/plant-current-period-kpi?plant=${encodeURIComponent(plant)}&group_by=${groupBy}`);

export const GOLDEN_BATCH_ID = 'PAR-GOLDEN';

// --- Running Batch Monitoring / Live Telemetry ---

export interface RunningBatchSummary {
  running_batch_id: string;
  plant: string;
  product: string;
  status: 'Running' | 'Completed' | 'Stopped';
  scenario_profile: 'Normal' | 'Warning' | 'Critical';
  drifting_parameter: string | null;
  phase: string;
  started_at: string;
  elapsed_minutes: number;
  target_duration_minutes: number;
  // Set once this batch has been persisted to historical batches/batch_kpis
  // (e.g. "PAR-120") - null if never persisted (still Running/Stopped).
  history_batch_id: string | null;
}

export interface LiveTelemetryPoint {
  elapsed_minutes: number;
  recorded_at: string;
  phase: string;
  temperature: number;
  process_pressure: number;
  flow_rate: number;
  agitator_rpm: number;
  inlet_air_humidity: number;
  exhaust_air_temp: number;
  filter_differential_pressure: number;
  shaker_vibration_frequency: number;
  product_bed_temp: number;
  chamber_differential_pressure: number;
  ahu_damper_position: number;
  compressed_air_pressure: number;
}

export interface LiveParameterPrediction {
  key: string;
  predicted: number;
  ci_low: number;
  ci_high: number;
  alert_level: 'Normal' | 'Warning' | 'Critical';
}

export interface LivePrediction {
  horizon_minutes: number;
  computed_at_elapsed_minutes: number;
  parameters: LiveParameterPrediction[];
}

export type AgentUrgency = 'Immediate Action Required' | 'Action Recommended Soon' | 'Monitor Closely' | 'Informational Only';

// Process Parameter Deviation Agent's per-parameter output - Current and
// Predicted are kept as separate fields throughout (a parameter can be fine
// now but forecast to breach soon, or vice versa). Detect/Project
// (current_status/predicted_status/time_to_breach_minutes/confidence) are
// deterministic; alert_summary/trigger_explanation/urgency/likely_root_cause/
// recommended_action/operational_impact are the LLM reasoning layer's
// synthesized output (Azure OpenAI, with a deterministic fallback), all null
// until trigger_type is set.
export interface ParameterAssessment {
  key: string;
  current_status: 'normal' | 'warning' | 'critical';
  current_observation: string;
  predicted_status: 'normal' | 'warning' | 'critical' | null;
  predicted_observation: string | null;
  time_to_breach_minutes: number | null;
  confidence: 'High' | 'Medium' | 'Low' | null;
  likely_root_cause: string | null;
  recommended_action: string | null;
  trigger_type: 'current' | 'predicted' | 'both' | null;
  alert_summary: string | null;
  trigger_explanation: string | null;
  urgency: AgentUrgency | null;
  operational_impact: string | null;
  // Deterministic, evidence-based confidence in the diagnosis/action itself
  // (app.live.confidence) - distinct from `confidence` above, which is the
  // ML forecast's own confidence-interval-width confidence.
  root_cause_confidence_pct: number | null;
  root_cause_confidence_level: 'High' | 'Medium' | 'Low' | null;
  root_cause_confidence_explanation: string | null;
  recommendation_confidence_pct: number | null;
  recommendation_confidence_level: 'High' | 'Medium' | 'Low' | null;
  recommendation_confidence_explanation: string | null;
  // Which path actually produced alert_summary/.../operational_impact above
  // - 'static' (deterministic template) or 'llm' (real Azure OpenAI call).
  reasoning_source: 'static' | 'llm' | null;
}

export interface RunningBatchTelemetryResponse {
  batch: RunningBatchSummary;
  points: LiveTelemetryPoint[];
  // null until 30+ minutes of history exist for this batch.
  prediction: LivePrediction | null;
  assessments: ParameterAssessment[];
}

// --- Process Parameter Deviation Agent alerts (feeds AI Review Desk) ---

export interface DeviationAlert {
  alert_id: string;
  running_batch_id: string;
  plant: string;
  parameter: string;
  parameter_label: string;
  trigger_type: 'current' | 'predicted' | 'both';
  severity: 'Warning' | 'Critical';
  detected_at_elapsed_minutes: number;
  created_at: string;
  observation: string;
  predicted_observation: string | null;
  time_to_breach_minutes: number | null;
  confidence: 'High' | 'Medium' | 'Low' | null;
  likely_root_cause: string | null;
  recommended_action: string | null;
  status: 'Open' | 'Resolved'; // the agent's own detection state
  resolved_at_elapsed_minutes: number | null;
  resolved_at: string | null;
  // LLM reasoning layer output, persisted on the alert at creation/material-
  // change time - the same explanation shown in Process Monitoring stays
  // stable here even as the live batch continues past that point.
  alert_summary: string | null;
  trigger_explanation: string | null;
  urgency: AgentUrgency | null;
  operational_impact: string | null;
  // Deterministic, evidence-based confidence in the diagnosis/action itself
  // (app.live.confidence) - distinct from `confidence` above.
  root_cause_confidence_pct: number | null;
  root_cause_confidence_level: 'High' | 'Medium' | 'Low' | null;
  root_cause_confidence_explanation: string | null;
  recommendation_confidence_pct: number | null;
  recommendation_confidence_level: 'High' | 'Medium' | 'Low' | null;
  recommendation_confidence_explanation: string | null;
  // Which path actually produced the reasoning text above - 'static' or 'llm'.
  reasoning_source: 'static' | 'llm' | null;
  // The human's decision - separate from `status` above: an operator can
  // acknowledge an alert that's still actively deviating, and the agent can
  // resolve an alert nobody ever reviewed.
  human_decision: 'Acknowledged' | 'Rejected' | null;
  human_decision_at: string | null;
  // Which agent produced this alert.
  source: 'process_parameter' | 'kpi_prediction';
}

export const fetchAlerts = (status?: 'Open' | 'Resolved'): Promise<DeviationAlert[]> =>
  fetchJson(`/alerts${status ? `?status=${status}` : ''}`);

// Real backend actions - persist the operator's decision on the alert
// record itself (survives page refreshes and backend restarts), replacing
// the earlier browser-only status override.
export const acknowledgeAlert = (alertId: string): Promise<DeviationAlert> =>
  postJson(`/alerts/${encodeURIComponent(alertId)}/acknowledge`);

export const rejectAlert = (alertId: string): Promise<DeviationAlert> =>
  postJson(`/alerts/${encodeURIComponent(alertId)}/reject`);

export const fetchRunningBatches = (): Promise<RunningBatchSummary[]> => fetchJson('/live-batches');

export const fetchRunningBatchTelemetry = (runningBatchId: string): Promise<RunningBatchTelemetryResponse> =>
  fetchJson(`/live-batches/${encodeURIComponent(runningBatchId)}/telemetry`);

export const createRunningBatch = (
  plant: string,
  scenarioProfile: 'Normal' | 'Warning' | 'Critical' = 'Normal',
  driftingParameter?: string | null,
): Promise<RunningBatchSummary> =>
  postJson('/live-batches', {
    plant,
    scenario_profile: scenarioProfile,
    ...(driftingParameter ? { drifting_parameter: driftingParameter } : {}),
  });

export const stopRunningBatch = (runningBatchId: string): Promise<RunningBatchSummary> =>
  postJson(`/live-batches/${encodeURIComponent(runningBatchId)}/stop`);

// --- AI Analysis Mode (global switch, see backend/app/live/ai_mode.py) ---
// 'static': deterministic fallback reasoning only, no LLM calls (default,
// keeps LLM cost fully opt-in). 'agent_llm': real Azure OpenAI reasoning for
// Warning/Critical deviations. Root Cause/Recommendation Confidence
// percentages are unaffected either way - those are deterministic by design
// regardless of this mode.
export type AIMode = 'static' | 'agent_llm';

export const fetchAiMode = (): Promise<{ mode: AIMode }> => fetchJson('/settings/ai-mode');

export const setAiMode = (mode: AIMode): Promise<{ mode: AIMode }> =>
  postJson('/settings/ai-mode', { mode });

// Real seconds of wall-clock time per simulated minute (see
// backend/app/live/config.py's TICK_INTERVAL_SECONDS) - fetched rather than
// hardcoded so the displayed cadence can never drift out of sync with the
// backend's actual speed profile.
export const fetchTickIntervalSeconds = (): Promise<{ tick_interval_seconds: number }> =>
  fetchJson('/settings/tick-interval');

// --- KPI Prediction & Deviation Agent ---
// Standalone from the process-parameter forecast above: a separate model
// trained on synthetic data (see backend/app/live/kpi_prediction_agent.py
// and scripts/generate-synthetic-kpi-data/), since Yield/Quality Score/SEC/
// OEE/Total Energy have no real within-batch temporal signal to learn from.
// Predicts each batch's FINAL outcome (not a 30-min-ahead snapshot) from
// whatever process-parameter history is available so far - Yield/Quality/
// SEC/OEE/Total Energy are inherently single, end-of-batch outcomes, unlike
// the continuously-forecastable process parameters above.

export type KpiKey = 'yield_pct' | 'quality_score_pct' | 'sec_kwh_per_kg' | 'oee_pct' | 'total_energy_kwh';

export interface KpiContributingParameter {
  key: string;
  label: string;
  unit: string;
  current: number;
  golden: number;
  deviation: number;
  direction: 'up' | 'down' | 'stable';
  deviation_score: number;
}

export interface KpiPrediction {
  key: KpiKey;
  label: string;
  unit: string;
  predicted_final: number;
  golden_final: number;
  deviation_pct: number;
  status: 'normal' | 'warning' | 'critical';
  confidence: 'High' | 'Medium' | 'Low';
  // Plain-language reason the confidence is at this level (e.g. "Batch just
  // started - too early to trust this yet") - shown alongside the badge so
  // the operator knows WHY, not just the level.
  confidence_reason: string;
  contributing_parameters: KpiContributingParameter[];
  // LLM reasoning layer output (backend/app/live/kpi_llm_agent.py) - mirrors
  // app.live.llm_agent's Azure OpenAI + fallback pattern. Static mode (the
  // default) uses a deterministic fallback template; Agent LLM mode calls
  // Azure OpenAI, falling back to the same template on any failure.
  // reasoning_source reports which one actually produced this text.
  kpi_summary: string;
  deviation_explanation: string;
  urgency: AgentUrgency;
  recommended_action: string;
  operational_impact: string;
  reasoning_source: 'static' | 'llm';
}

export interface KpiHistoryPoint {
  elapsed_minutes: number;
  temperature: number;
  process_pressure: number;
  flow_rate: number;
  agitator_rpm: number;
  inlet_air_humidity: number;
  exhaust_air_temp: number;
  filter_differential_pressure: number;
  shaker_vibration_frequency: number;
  product_bed_temp: number;
  chamber_differential_pressure: number;
  ahu_damper_position: number;
  compressed_air_pressure: number;
}

export interface KpiPredictionResponse {
  running_batch_id: string;
  elapsed_minutes: number;
  kpis: KpiPrediction[];
  // Newest-first, last 10 readings, all 4 process parameters - not just
  // whichever 1-3 are flagged as top contributors in kpis[].contributing_parameters.
  history: KpiHistoryPoint[];
}

export const fetchKpiPrediction = (runningBatchId: string): Promise<KpiPredictionResponse> =>
  fetchJson(`/kpi-prediction/${encodeURIComponent(runningBatchId)}`);
