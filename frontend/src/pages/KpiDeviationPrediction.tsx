// KPI Prediction & Deviation - standalone page, separate from Process
// Monitoring's parameter-level forecast. Predicts each batch's FINAL Yield/
// Quality Score/SEC/OEE/Total Energy (not a 30-min-ahead snapshot) from
// whatever process-parameter history is available so far (see
// backend/app/live/kpi_prediction_agent.py), compares to the Golden Batch's
// final target, classifies Normal/Warning/Critical, and surfaces which
// process parameters are most responsible. Predictions made early in a
// batch are honestly less reliable than ones made later - that's reflected
// in the confidence indicator, not hidden.
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Gauge, Loader2, XCircle } from 'lucide-react';
import { fetchRunningBatches, fetchKpiPrediction, fetchTickIntervalSeconds, fetchAiMode, setAiMode } from '../lib/api';
import type { RunningBatchSummary, KpiPredictionResponse, KpiPrediction, KpiKey, AIMode } from '../lib/api';

const LIVE_POLL_INTERVAL_MS = 3000;

type Status = 'normal' | 'warning' | 'critical';

const STATUS_BADGE: Record<Status, string> = {
  normal: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  critical: 'bg-red-50 text-red-700 border-red-200',
};

const STATUS_ICON: Record<Status, typeof CheckCircle2> = {
  normal: CheckCircle2,
  warning: AlertTriangle,
  critical: XCircle,
};

const STATUS_LABEL: Record<Status, string> = {
  normal: 'Normal',
  warning: 'Warning',
  critical: 'Critical',
};

const CONFIDENCE_STYLE: Record<string, string> = {
  High: 'text-emerald-700',
  Medium: 'text-amber-700',
  Low: 'text-gray-500',
};

const DIRECTION_ARROW: Record<string, string> = { up: '↑', down: '↓', stable: '→' };

// Same urgency scale/severity ordering used by Process Monitoring's Agent
// Assessment panel (app.live.llm_agent's URGENCY_LEVELS) - kept visually
// consistent since it's the same reasoning-layer pattern, just for KPIs.
const URGENCY_STYLE: Record<string, string> = {
  'Immediate Action Required': 'bg-red-600 text-white',
  'Action Recommended Soon': 'bg-amber-500 text-white',
  'Monitor Closely': 'bg-amber-100 text-amber-800',
  'Informational Only': 'bg-gray-100 text-gray-600',
};

const KPI_ORDER: KpiKey[] = ['yield_pct', 'quality_score_pct', 'sec_kwh_per_kg', 'oee_pct', 'total_energy_kwh'];

export default function KpiDeviationPrediction() {
  const [runningBatches, setRunningBatches] = useState<RunningBatchSummary[]>([]);
  const [runningBatchesLoading, setRunningBatchesLoading] = useState(true);
  const [runningBatchesError, setRunningBatchesError] = useState<string | null>(null);
  const [selectedRunningBatchId, setSelectedRunningBatchId] = useState<string | null>(null);

  const [prediction, setPrediction] = useState<KpiPredictionResponse | null>(null);
  const [waitingForHistory, setWaitingForHistory] = useState(false);
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [selectedKpiKey, setSelectedKpiKey] = useState<KpiKey>('yield_pct');
  const [tickIntervalSeconds, setTickIntervalSeconds] = useState<number | null>(null);

  // Global switch (backend/app/live/ai_mode.py) - the SAME toggle Process
  // Monitoring's Agent Assessment panel uses, not a separate one: flipping
  // it here also changes it there, since both read app.live.kpi_llm_agent /
  // app.live.llm_agent's shared ai_mode.get_mode(). Static (default) uses
  // deterministic fallback reasoning with no LLM calls; Agent LLM Mode calls
  // the real Azure OpenAI agent.
  const [aiMode, setAiModeState] = useState<AIMode>('static');
  const [aiModeUpdating, setAiModeUpdating] = useState(false);

  const selectedRunningBatch = runningBatches.find((b) => b.running_batch_id === selectedRunningBatchId) ?? null;

  useEffect(() => {
    fetchTickIntervalSeconds().then((r) => setTickIntervalSeconds(r.tick_interval_seconds)).catch(() => {});
    fetchAiMode().then((r) => setAiModeState(r.mode)).catch(() => {});
  }, []);

  const handleToggleAiMode = () => {
    const next: AIMode = aiMode === 'static' ? 'agent_llm' : 'static';
    setAiModeUpdating(true);
    setAiMode(next)
      .then((r) => setAiModeState(r.mode))
      .catch(() => {})
      .finally(() => setAiModeUpdating(false));
  };

  useEffect(() => {
    let cancelled = false;
    setRunningBatchesLoading(true);
    setRunningBatchesError(null);
    fetchRunningBatches()
      .then((data) => {
        if (cancelled) return;
        setRunningBatches(data);
        setSelectedRunningBatchId((prev) => prev ?? (data.length > 0 ? data[0].running_batch_id : null));
      })
      .catch((err) => {
        if (!cancelled) setRunningBatchesError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setRunningBatchesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Guards against overlapping fetchKpiPrediction calls: in Agent LLM mode
  // each request can take much longer than the 3s poll interval (up to ~5
  // real Azure OpenAI calls), so without this a slow first request could
  // still be in flight when several more had already been fired - each
  // resolving independently, in whatever order the network happened to
  // deliver them, and overwriting the displayed prediction with stale/
  // out-of-order data. Skipping a poll tick while one is still pending
  // means the page always shows the most recent request's result, not
  // whichever one happened to land last.
  const kpiFetchInFlightRef = useRef(false);

  useEffect(() => {
    if (!selectedRunningBatchId) return;
    let cancelled = false;

    const poll = () => {
      // Refresh the batch's own live status (elapsed minutes, phase, etc.)
      // every tick regardless of whether the KPI prediction below succeeds -
      // fetchKpiPrediction only returns data once 30+ minutes of history
      // exist, so relying on it alone left the elapsed-minutes counter
      // frozen for the entire first 30 minutes of every batch.
      fetchRunningBatches()
        .then((data) => {
          if (cancelled) return;
          setRunningBatches(data);
        })
        .catch(() => {
          // A transient poll failure isn't worth a full-page error state -
          // the next tick will retry.
        });

      if (kpiFetchInFlightRef.current) return;
      kpiFetchInFlightRef.current = true;

      fetchKpiPrediction(selectedRunningBatchId)
        .then((data) => {
          if (cancelled) return;
          setPrediction(data);
          setWaitingForHistory(false);
          setPredictionError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes('30+ minutes')) {
            setWaitingForHistory(true);
            setPredictionError(null);
          } else {
            setPredictionError(message);
          }
          setPrediction(null);
        })
        .finally(() => {
          kpiFetchInFlightRef.current = false;
        });
    };

    setPrediction(null);
    setWaitingForHistory(false);
    setPredictionError(null);
    poll();
    const interval = setInterval(poll, LIVE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedRunningBatchId]);

  const selectedKpi: KpiPrediction | undefined = prediction?.kpis.find((k) => k.key === selectedKpiKey);

  if (runningBatchesLoading) {
    return (
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-sm text-gray-500">Loading running batches...</div>
      </div>
    );
  }

  if (runningBatchesError) {
    return (
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-red-800">Could not load running batches</p>
          <p className="text-xs text-red-700 mt-1 leading-relaxed">{runningBatchesError}</p>
        </div>
      </div>
    );
  }

  if (runningBatches.length === 0) {
    return (
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center text-sm text-gray-500">No running batches right now.</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between md:items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Gauge className="text-blue-600" size={24} />
            KPI Prediction & Deviation
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-gray-500">Live simulated telemetry for</p>
            <select
              value={selectedRunningBatchId ?? ''}
              onChange={(e) => setSelectedRunningBatchId(e.target.value)}
              className="bg-gray-50 border border-gray-200 text-sm text-gray-700 rounded font-medium px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              {runningBatches.map((b) => (
                <option key={b.running_batch_id} value={b.running_batch_id}>
                  {b.running_batch_id} ({b.status})
                </option>
              ))}
            </select>
            {selectedRunningBatch && <p className="text-sm text-gray-500">at {selectedRunningBatch.plant}</p>}
          </div>
          {selectedRunningBatch && (
            <p className="text-xs text-black mt-1 flex items-center font-medium gap-1.5 flex-wrap">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Simulated live feed
              {tickIntervalSeconds != null && (
                <span>· Updates every {Number.isInteger(tickIntervalSeconds) ? tickIntervalSeconds : tickIntervalSeconds.toFixed(1)}s</span>
              )}
              <span>· {selectedRunningBatch.elapsed_minutes} / {selectedRunningBatch.target_duration_minutes} min</span>
            </p>
          )}
        </div>

        {/* Global switch (backend/app/live/ai_mode.py) - shared with Process
            Monitoring's own toggle, not a separate setting. */}
        <div className="flex flex-col items-end self-start">
          <span className="text-[11.25px] font-bold text-gray-400 uppercase tracking-wider mb-1">AI Analysis Mode</span>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold transition-colors ${aiMode === 'static' ? 'text-gray-700' : 'text-gray-400'}`}>Static</span>
            <button
              type="button"
              role="switch"
              aria-checked={aiMode === 'agent_llm'}
              onClick={handleToggleAiMode}
              disabled={aiModeUpdating}
              title={aiMode === 'static'
                ? 'Static: deterministic template reasoning, no LLM calls. Click to turn on Agent LLM Mode.'
                : 'Agent LLM Mode: real AI agent reasoning. Click to turn off.'}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-wait ${
                aiMode === 'agent_llm' ? 'bg-indigo-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  aiMode === 'agent_llm' ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className={`text-xs font-semibold transition-colors flex items-center gap-1 ${aiMode === 'agent_llm' ? 'text-indigo-700' : 'text-gray-400'}`}>
              {aiModeUpdating && <Loader2 size={10} className="animate-spin" />}
              Agent
            </span>
          </div>
        </div>
      </div>

      {waitingForHistory && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center text-sm text-gray-500 flex items-center justify-center gap-2">
          <Clock size={16} />
          Waiting for 30 minutes of history before the first KPI forecast can be made ({selectedRunningBatch?.elapsed_minutes ?? 0}/30 min).
        </div>
      )}

      {predictionError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-red-800">Could not load KPI prediction</p>
          <p className="text-xs text-red-700 mt-1 leading-relaxed">{predictionError}</p>
        </div>
      )}

      {prediction && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {KPI_ORDER.map((key) => {
              const kpi = prediction.kpis.find((k) => k.key === key);
              if (!kpi) return null;
              const Icon = STATUS_ICON[kpi.status];
              const isSelected = kpi.key === selectedKpiKey;
              const decimals = kpi.unit === 'kWh/kg' ? 3 : kpi.unit === 'kWh' ? 1 : 1;
              return (
                <button
                  key={kpi.key}
                  onClick={() => setSelectedKpiKey(kpi.key)}
                  className={`text-left bg-white rounded-xl border p-4 transition-all ${
                    isSelected ? 'border-blue-500 ring-2 ring-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">{kpi.label}</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11.25px] font-bold border ${STATUS_BADGE[kpi.status]}`}>
                      <Icon size={11} />
                      {STATUS_LABEL[kpi.status]}
                    </span>
                  </div>
                  <span className="text-[11.25px] font-bold text-gray-400 uppercase tracking-wider">Predicted</span>
                  <p className="text-2xl font-bold text-gray-900">
                    {kpi.predicted_final.toFixed(decimals)}
                    <span className="text-sm font-medium text-gray-400 ml-1">{kpi.unit}</span>
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Golden Batch: {kpi.golden_final.toFixed(decimals)}{kpi.unit}
                    <span className={kpi.deviation_pct < 0 ? 'text-red-600 font-semibold ml-1' : 'text-gray-500 ml-1'}>
                      ({kpi.deviation_pct > 0 ? '+' : ''}{kpi.deviation_pct.toFixed(1)}%)
                    </span>
                  </p>
                </button>
              );
            })}
          </div>

          {selectedKpi && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-gray-900">{selectedKpi.label} - Final Outcome Investigation</h2>
                    <span
                      title="Applies to the summary, explanation, recommendation, and impact below - all generated together in one pass"
                      className={`px-2 py-0.5 rounded-full text-[11.25px] font-bold ${
                        selectedKpi.reasoning_source === 'llm' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-600'
                      }`}
                    >
                      {selectedKpi.reasoning_source === 'llm' ? 'AI Generated' : 'Static Template'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    Predicted final result for this batch · {prediction.elapsed_minutes} min elapsed so far
                  </p>
                  <p className="text-sm text-gray-800 mt-2 font-medium">{selectedKpi.kpi_summary}</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right max-w-[220px]">
                    <span className="text-[11.25px] font-bold text-gray-400 uppercase tracking-wider block">Forecast Confidence</span>
                    <span className={`text-sm font-bold ${CONFIDENCE_STYLE[selectedKpi.confidence]}`}>{selectedKpi.confidence}</span>
                    <p className="text-[12.38px] text-gray-500 leading-snug mt-0.5">{selectedKpi.confidence_reason}</p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[11.25px] font-bold ${URGENCY_STYLE[selectedKpi.urgency]}`}>
                    {selectedKpi.urgency}
                  </span>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${STATUS_BADGE[selectedKpi.status]}`}>
                    {STATUS_LABEL[selectedKpi.status]}
                  </span>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Why</h3>
                <p className="text-sm text-gray-700 leading-relaxed">{selectedKpi.deviation_explanation}</p>
              </div>

              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Contributing Process Parameters</h3>
                {selectedKpi.contributing_parameters.length === 0 ? (
                  <p className="text-sm text-gray-500">No parameter is meaningfully deviating from its Golden Batch target right now.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {selectedKpi.contributing_parameters.map((p) => (
                      <div key={p.key} className="border border-gray-200 rounded-lg p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-gray-800">{p.label}</span>
                          <span className="text-sm font-bold text-gray-500">{DIRECTION_ARROW[p.direction]}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          Actual: {p.current}{p.unit} vs Golden Batch: {p.golden}{p.unit}
                        </p>
                        <p className="text-[11.25px] text-gray-400 mt-1">Deviation score: {p.deviation_score}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* All 12 process parameters, not just whichever 1-3 are
                  flagged as top contributors above - so a parameter that's
                  currently fine is still visible, not just the ones singled
                  out as problems. Same table convention as Process
                  Monitoring's own History table. */}
              {prediction.history.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                    Process Parameter History <span className="font-normal text-gray-400">(last {prediction.history.length} min)</span>
                  </h3>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="overflow-auto max-h-64">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="text-gray-400 text-[11.25px] uppercase tracking-wide bg-gray-50">
                            <th className="text-left font-semibold px-3 py-2 sticky left-0 bg-gray-50">Min</th>
                            <th className="text-right font-semibold px-3 py-2">Temperature (°C)</th>
                            <th className="text-right font-semibold px-3 py-2">Pressure (bar)</th>
                            <th className="text-right font-semibold px-3 py-2">Flow Rate (L/min)</th>
                            <th className="text-right font-semibold px-3 py-2">Agitator (RPM)</th>
                            <th className="text-right font-semibold px-3 py-2">Inlet Humidity (%RH)</th>
                            <th className="text-right font-semibold px-3 py-2">Exhaust Temp (°C)</th>
                            <th className="text-right font-semibold px-3 py-2">Filter DP (mbar)</th>
                            <th className="text-right font-semibold px-3 py-2">Shaker (Hz)</th>
                            <th className="text-right font-semibold px-3 py-2">Bed Temp (°C)</th>
                            <th className="text-right font-semibold px-3 py-2">Chamber DP (mbar)</th>
                            <th className="text-right font-semibold px-3 py-2">Damper (%)</th>
                            <th className="text-right font-semibold px-3 py-2">Compressed Air (bar)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {prediction.history.map((row, idx) => (
                            <tr key={row.elapsed_minutes} className={idx === 0 ? 'bg-indigo-50' : ''}>
                              <td className={`px-3 py-1.5 font-medium sticky left-0 ${idx === 0 ? 'bg-indigo-50 text-indigo-700' : 'bg-white text-gray-500'}`}>{row.elapsed_minutes}</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{row.temperature.toFixed(2)}</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{row.process_pressure.toFixed(2)}</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{row.flow_rate.toFixed(2)}</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{row.agitator_rpm.toFixed(2)}</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{row.inlet_air_humidity.toFixed(2)}</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{row.exhaust_air_temp.toFixed(2)}</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{row.filter_differential_pressure.toFixed(2)}</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{row.shaker_vibration_frequency.toFixed(2)}</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{row.product_bed_temp.toFixed(2)}</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{row.chamber_differential_pressure.toFixed(2)}</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{row.ahu_damper_position.toFixed(2)}</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{row.compressed_air_pressure.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4">
                <h3 className="text-xs font-bold text-indigo-700 uppercase tracking-wider mb-1.5">Recommended Action</h3>
                <p className="text-sm text-indigo-900 leading-relaxed">{selectedKpi.recommended_action}</p>
              </div>

              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Operational Impact</h3>
                <p className="text-sm text-gray-700 leading-relaxed">{selectedKpi.operational_impact}</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
