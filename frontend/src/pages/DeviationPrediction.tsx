import { useEffect, useState } from 'react';
import { BrainCircuit, Info, Clock, Loader2, AlertTriangle } from 'lucide-react';
import { fetchBatches, fetchPrediction } from '../lib/api';
import type { BatchSummary, PredictionResponse } from '../lib/api';

const ALERT_STYLES: Record<string, { badge: string; card: string; dot: string; text: string }> = {
  Normal: { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', card: 'border-gray-200', dot: 'bg-green-500', text: 'text-emerald-600' },
  Warning: { badge: 'bg-amber-50 text-amber-700 border-amber-200', card: 'border-amber-300 ring-1 ring-amber-100', dot: 'bg-yellow-500', text: 'text-amber-600' },
  Critical: { badge: 'bg-red-50 text-red-700 border-red-200', card: 'border-red-300 ring-1 ring-red-100', dot: 'bg-red-500', text: 'text-red-600' },
  'Not Applicable': { badge: 'bg-gray-50 text-gray-500 border-gray-200', card: 'border-gray-200', dot: 'bg-gray-300', text: 'text-gray-500' },
};

// Plain-language relabeling of the backend's raw evaluation categories, so
// this reads without needing to know what "recall" or "false positive" mean.
// Severity-coded: green = model worked, gray = nothing happened (least
// interesting), orange = an unnecessary alert, red = a real deviation the
// model didn't catch (the case that matters most).
const CORRECTNESS_DISPLAY: Record<string, { label: string; badge: string }> = {
  'Correct catch': { label: 'Deviation caught', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  'Correct quiet': { label: 'Correctly stayed normal', badge: 'bg-gray-100 text-gray-600 border-gray-200' },
  Missed: { label: 'Deviation not caught', badge: 'bg-red-50 text-red-700 border-red-200' },
  'False alarm': { label: 'Unnecessary alert', badge: 'bg-orange-50 text-orange-700 border-orange-200' },
};

const DEBOUNCE_MS = 250;

export default function DeviationPrediction() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [batchesError, setBatchesError] = useState<string | null>(null);

  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [elapsedMinutes, setElapsedMinutes] = useState<number | null>(null);

  const [prediction, setPrediction] = useState<PredictionResponse | null>(null);
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [predictionError, setPredictionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBatchesLoading(true);
    setBatchesError(null);
    fetchBatches()
      .then((data) => {
        if (cancelled) return;
        setBatches(data);
        if (data.length > 0) {
          setSelectedBatchId(data[0].batch_id);
          setElapsedMinutes(data[0].valid_time_range.min_elapsed_minutes);
        }
      })
      .catch((err) => {
        if (!cancelled) setBatchesError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setBatchesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedBatchId || elapsedMinutes === null) return;
    let cancelled = false;
    setPredictionLoading(true);
    const timeout = setTimeout(() => {
      fetchPrediction(selectedBatchId, elapsedMinutes)
        .then((data) => {
          if (cancelled) return;
          setPrediction(data);
          setPredictionError(null);
        })
        .catch((err) => {
          if (!cancelled) setPredictionError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setPredictionLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [selectedBatchId, elapsedMinutes]);

  const selectedBatch = batches.find((b) => b.batch_id === selectedBatchId) ?? null;

  const handleBatchChange = (batchId: string) => {
    const batch = batches.find((b) => b.batch_id === batchId);
    setSelectedBatchId(batchId);
    setElapsedMinutes(batch ? batch.valid_time_range.min_elapsed_minutes : null);
  };

  const activeLevels = prediction?.parameters.filter((p) => p.applicable).map((p) => p.alert_level) ?? [];
  const overallStatus = activeLevels.includes('Critical') ? 'Critical' : activeLevels.includes('Warning') ? 'Warning' : 'Normal';
  const overallStyle = ALERT_STYLES[overallStatus];

  if (batchesLoading) {
    return (
      <div className="max-w-7xl mx-auto flex flex-col items-center justify-center h-96 gap-3 text-gray-500">
        <Loader2 className="animate-spin" size={28} />
        <p className="text-sm font-medium">Loading test batches from the prediction API…</p>
      </div>
    );
  }

  if (batchesError) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 flex items-start gap-3">
          <AlertTriangle className="text-red-500 mt-0.5 shrink-0" size={20} />
          <div>
            <h2 className="text-sm font-bold text-red-800">Could not load test batches</h2>
            <p className="text-xs text-red-700 mt-1 leading-relaxed">{batchesError}</p>
          </div>
        </div>
      </div>
    );
  }

  if (batches.length === 0 || !selectedBatch) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center text-sm text-gray-500">
          No test batches available.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BrainCircuit className="h-6 w-6 text-indigo-600" /> Process Parameter Deviation Prediction
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            30-minute-ahead forecast from the trained Random Forest model, served live via the FastAPI backend
          </p>
        </div>
        <div className="text-right">
          <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Batch</span>
          <select
            value={selectedBatch.batch_id}
            onChange={(e) => handleBatchChange(e.target.value)}
            className="bg-gray-50 border border-gray-200 text-sm text-gray-800 font-mono rounded-md px-2 py-1 mt-0.5 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
          >
            {batches.map((b) => (
              <option key={b.batch_id} value={b.batch_id}>
                {b.batch_id} — {b.ground_truth_severity === 'Normal' ? 'Normal' : `${b.ground_truth_severity} (${b.ground_truth_scenario.replace(/_/g, ' ')})`}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 flex items-start gap-3">
        <Info size={18} className="text-indigo-500 mt-0.5 shrink-0" />
        <p className="text-xs text-indigo-900 leading-relaxed">
          <strong>Model validation view.</strong> Pick any of the {batches.length} held-out test batches and any valid moment within it —
          the prediction below is computed live by the trained Random Forest through the FastAPI backend, not a precomputed snapshot.
          For validation context, this batch's recorded outcome was{' '}
          <strong>{selectedBatch.ground_truth_severity === 'Normal' ? 'Normal (no fault)' : `${selectedBatch.ground_truth_scenario.replace(/_/g, ' ')}, ${selectedBatch.ground_truth_severity} severity`}</strong>.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
            <Clock size={12} /> Point in time within this batch
          </span>
          <span className="text-sm font-bold text-gray-900">
            {elapsedMinutes} / {selectedBatch.batch_duration_minutes} min
          </span>
        </div>
        <input
          type="range"
          min={selectedBatch.valid_time_range.min_elapsed_minutes}
          max={selectedBatch.valid_time_range.max_elapsed_minutes}
          value={elapsedMinutes ?? selectedBatch.valid_time_range.min_elapsed_minutes}
          onChange={(e) => setElapsedMinutes(Number(e.target.value))}
          className="w-full accent-indigo-600 cursor-pointer"
        />
        <p className="text-[10px] text-gray-400 mt-1">
          Valid prediction window for this batch: {selectedBatch.valid_time_range.min_elapsed_minutes}–{selectedBatch.valid_time_range.max_elapsed_minutes} min
          (outside this range there isn't 30 minutes of history yet, no future value to check yet, or the golden band doesn't apply to that phase)
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Plant / Product</span>
          <div className="text-sm font-bold text-gray-900 mt-1">{selectedBatch.plant}</div>
          <div className="text-xs text-gray-500">{selectedBatch.product}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
            <Clock size={12} /> Elapsed / Duration
          </span>
          <div className="text-sm font-bold text-gray-900 mt-1">{elapsedMinutes} / {selectedBatch.batch_duration_minutes} min</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Prediction Horizon</span>
          <div className="text-sm font-bold text-gray-900 mt-1">+{prediction?.horizon_minutes ?? 30} minutes</div>
        </div>
        <div className={`bg-white rounded-xl border shadow-sm p-4 ${overallStyle.card}`}>
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Overall Batch Status</span>
          <div className={`text-sm font-bold mt-1 ${overallStyle.text}`}>{prediction ? overallStatus : '—'}</div>
        </div>
      </div>

      {predictionError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="text-red-500 mt-0.5 shrink-0" size={18} />
          <p className="text-xs text-red-700 leading-relaxed">{predictionError}</p>
        </div>
      )}

      <div className={predictionLoading ? 'opacity-50 pointer-events-none transition-opacity' : 'transition-opacity'}>
        <div className="flex items-center justify-between mb-3 pl-1">
          <h3 className="text-base font-bold text-gray-800 uppercase tracking-wider">Parameter Forecast</h3>
          {predictionLoading && (
            <span className="text-xs text-gray-400 flex items-center gap-1.5">
              <Loader2 className="animate-spin" size={12} /> Updating…
            </span>
          )}
        </div>

        {!prediction ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 h-48 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {prediction.parameters.map((p) => {
              const style = ALERT_STYLES[p.alert_level];
              return (
                <div key={p.key} className={`bg-white rounded-xl shadow-sm border p-5 flex flex-col justify-between ${style.card}`}>
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-sm font-semibold text-gray-700">{p.label}</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${style.badge}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`}></span>
                      {p.alert_level}
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex justify-between items-baseline">
                      <span className="text-[10px] text-gray-400 uppercase font-semibold">Current</span>
                      <span className="text-lg font-bold text-gray-900">{p.current} {p.unit}</span>
                    </div>

                    {p.applicable ? (
                      <>
                        <div className="flex justify-between items-baseline">
                          <span className="text-[10px] text-gray-400 uppercase font-semibold">Predicted (+30m)</span>
                          <span className="text-base font-bold text-indigo-600">{p.predicted} {p.unit}</span>
                        </div>
                        <div className="flex justify-between items-baseline">
                          <span className="text-[10px] text-gray-400 uppercase font-semibold">90% Confidence</span>
                          <span className="text-xs font-mono text-gray-600">{p.ci_low} – {p.ci_high}</span>
                        </div>
                        <div className="flex justify-between items-baseline">
                          <span className="text-[10px] text-gray-400 uppercase font-semibold">Actual (+30m)</span>
                          <span className="text-sm font-bold text-gray-700">{p.actual} {p.unit}</span>
                        </div>
                        <div className="flex justify-between items-baseline">
                          <span className="text-[10px] text-gray-400 uppercase font-semibold">Error</span>
                          <span className={`text-xs font-mono ${Math.abs(p.error ?? 0) > 1 ? 'text-red-500' : 'text-gray-500'}`}>
                            {(p.error ?? 0) > 0 ? '+' : ''}{p.error} {p.unit}
                          </span>
                        </div>
                        {p.correctness && (
                          <div className="pt-1 space-y-1">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${CORRECTNESS_DISPLAY[p.correctness].badge}`}>
                              {CORRECTNESS_DISPLAY[p.correctness].label}
                            </span>
                            <div className="text-[10px] text-gray-400">
                              Predicted: <span className="font-semibold text-gray-500">{p.alert_level}</span>
                              {' · '}
                              Actual: <span className="font-semibold text-gray-500">{p.actual_alert_level ?? '—'}</span>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-[11px] text-gray-400 italic pt-1">
                        Idle during drying — not covered by deviation prediction in this phase.
                      </p>
                    )}

                    <div className="pt-2 border-t border-gray-100 flex justify-between items-center">
                      <span className="text-[10px] text-gray-400 uppercase font-semibold">Golden Limit</span>
                      <span className="text-[11px] font-mono text-gray-500">{p.lower_limit} – {p.upper_limit} {p.unit}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
