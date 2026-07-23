import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, ReferenceArea, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { BrainCircuit, Info, Loader2, AlertTriangle, History, Radio, Square } from 'lucide-react';
import {
  fetchBatches, fetchTimeline, fetchParameterConfig, fetchGoldenEnvelope, GOLDEN_BATCH_ID,
  fetchRunningBatches, fetchRunningBatchTelemetry, stopRunningBatch,
} from '../lib/api';
import type {
  BatchSummary, TimelineResponse, ParameterConfigEntry, GoldenEnvelopePoint,
  RunningBatchSummary, RunningBatchTelemetryResponse,
} from '../lib/api';

const WARNING_MARGIN_FRACTION = 0.15;
const LIVE_POLL_INTERVAL_MS = 3000;

type Mode = 'running' | 'completed';

// Shared shape both modes normalize into, so the rest of this component
// (cards, chart, stats) has exactly one code path regardless of data source.
// The running batch is treated as one continuous process end to end - no
// manufacturing-phase concept is surfaced here (the simulator still uses
// phases internally to generate realistic values, but this page doesn't
// know or care about that).
interface NormalizedPoint {
  elapsed_minutes: number;
  temperature: number;
  process_pressure: number;
  flow_rate: number;
  agitator_rpm: number;
}

interface ParamCard {
  key: string;
  label: string;
  unit: string;
  current: number;
  golden: number;
  // Golden(t) +/- data-derived offset, NOT the fixed parameter_config band -
  // see fetchGoldenEnvelope. Meaningful at every minute of the batch, not
  // just one stage of it, which is what replacing the fixed band fixes.
  lowerLimit: number;
  upperLimit: number;
  status: 'normal' | 'warning' | 'critical';
  // Live ML forecast for this parameter, 30 minutes ahead - undefined until
  // the running batch has 30+ minutes of history. Same trained model and CI
  // approach as Deviation Prediction, just no actual/correctness fields:
  // there's no ground truth yet for a batch that hasn't finished.
  prediction?: {
    predicted: number;
    // Golden batch's own reading 30 minutes from now (not "now") - the
    // predicted value is a future value, so it's compared against golden's
    // future value, the same "moving reference" idea as the current-value
    // Golden/Dev line above, just shifted forward by the forecast horizon.
    goldenFuture: number | undefined;
    alertLevel: 'Normal' | 'Warning' | 'Critical';
  };
}

const classifyStatus = (value: number, lo: number, hi: number): 'normal' | 'warning' | 'critical' => {
  if (value < lo || value > hi) return 'critical';
  const margin = (hi - lo) * WARNING_MARGIN_FRACTION;
  if (value < lo + margin || value > hi - margin) return 'warning';
  return 'normal';
};

const STATUS_DOT: Record<ParamCard['status'], string> = {
  normal: 'bg-green-500',
  warning: 'bg-yellow-500',
  critical: 'bg-red-500',
};

const SCENARIO_BADGE: Record<string, string> = {
  Normal: 'bg-emerald-100 text-emerald-800',
  Warning: 'bg-amber-100 text-amber-800',
  Critical: 'bg-red-100 text-red-800',
};

const PREDICTED_ALERT_BADGE: Record<string, string> = {
  Normal: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Warning: 'bg-amber-50 text-amber-700 border-amber-200',
  Critical: 'bg-red-50 text-red-700 border-red-200',
};

export default function ProcessMonitoring() {
  const [mode, setMode] = useState<Mode>('running');

  // --- Running-batch mode state ---
  const [runningBatches, setRunningBatches] = useState<RunningBatchSummary[]>([]);
  const [runningBatchesLoading, setRunningBatchesLoading] = useState(true);
  const [runningBatchesError, setRunningBatchesError] = useState<string | null>(null);
  const [selectedRunningBatchId, setSelectedRunningBatchId] = useState<string | null>(null);
  const [runningTelemetry, setRunningTelemetry] = useState<RunningBatchTelemetryResponse | null>(null);

  // --- Completed-batch mode state (existing behavior, unchanged) ---
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);

  // --- Shared reference data ---
  const [paramConfig, setParamConfig] = useState<ParameterConfigEntry[]>([]);
  const [goldenTimeline, setGoldenTimeline] = useState<TimelineResponse | null>(null);
  const [goldenEnvelope, setGoldenEnvelope] = useState<GoldenEnvelopePoint[]>([]);
  const [activeParamKey, setActiveParamKey] = useState('temperature');

  const selectedBatch = batches.find((b) => b.batch_id === selectedBatchId) ?? null;
  const selectedRunningBatch = runningBatches.find((b) => b.running_batch_id === selectedRunningBatchId) ?? null;

  useEffect(() => {
    fetchParameterConfig().then(setParamConfig).catch(() => setParamConfig([]));
    fetchTimeline(GOLDEN_BATCH_ID).then(setGoldenTimeline).catch(() => setGoldenTimeline(null));
    fetchGoldenEnvelope().then(setGoldenEnvelope).catch(() => setGoldenEnvelope([]));
  }, []);

  // Running batches list - fetched on mount; also refreshed by each telemetry
  // poll below so status (e.g. a batch completing) updates in the selector.
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

  // Poll live telemetry for the selected running batch.
  useEffect(() => {
    if (mode !== 'running' || !selectedRunningBatchId) return;
    let cancelled = false;

    const poll = () => {
      fetchRunningBatchTelemetry(selectedRunningBatchId)
        .then((data) => {
          if (cancelled) return;
          setRunningTelemetry(data);
          setRunningBatches((prev) => prev.map((b) => (b.running_batch_id === data.batch.running_batch_id ? data.batch : b)));
        })
        .catch(() => {
          // A transient poll failure isn't worth a full-page error state -
          // the next tick will retry.
        });
    };

    poll();
    const interval = setInterval(poll, LIVE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mode, selectedRunningBatchId]);

  // Historical batches - existing behavior, unchanged.
  useEffect(() => {
    let cancelled = false;
    setBatchesLoading(true);
    setBatchesError(null);
    fetchBatches()
      .then((data) => {
        if (cancelled) return;
        setBatches(data);
        setSelectedBatchId((prev) => prev ?? (data.length > 0 ? data[0].batch_id : null));
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
    if (mode !== 'completed' || !selectedBatchId) return;
    let cancelled = false;
    setTimelineLoading(true);
    fetchTimeline(selectedBatchId)
      .then((data) => {
        if (cancelled) return;
        setTimeline(data);
        setTimelineError(null);
      })
      .catch((err) => {
        if (!cancelled) setTimelineError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setTimelineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, selectedBatchId]);

  const goldenPointAt = (elapsedMinutes: number) => {
    if (!goldenTimeline || goldenTimeline.points.length === 0) return undefined;
    const exact = goldenTimeline.points.find((p) => p.elapsed_minutes === elapsedMinutes);
    if (exact) return exact;
    const maxGolden = goldenTimeline.points[goldenTimeline.points.length - 1];
    return elapsedMinutes > maxGolden.elapsed_minutes ? maxGolden : goldenTimeline.points[0];
  };

  const envelopeAt = (elapsedMinutes: number) => {
    if (goldenEnvelope.length === 0) return undefined;
    const exact = goldenEnvelope.find((e) => e.elapsed_minutes === elapsedMinutes);
    if (exact) return exact;
    const maxEnv = goldenEnvelope[goldenEnvelope.length - 1];
    return elapsedMinutes > maxEnv.elapsed_minutes ? maxEnv : goldenEnvelope[0];
  };

  const points: NormalizedPoint[] = useMemo(() => {
    if (mode === 'running') {
      return runningTelemetry?.points ?? [];
    }
    return timeline?.points ?? [];
  }, [mode, runningTelemetry, timeline]);

  const latestPoint = points.length > 0 ? points[points.length - 1] : null;

  const paramCards: ParamCard[] = useMemo(() => {
    if (!latestPoint || paramConfig.length === 0) return [];
    const goldenAtLatest = goldenPointAt(latestPoint.elapsed_minutes);
    const envelopeAtLatest = envelopeAt(latestPoint.elapsed_minutes);
    const goldenAt30 = goldenPointAt(latestPoint.elapsed_minutes + 30);

    return paramConfig.map((cfg) => {
      const current = latestPoint[cfg.key as keyof NormalizedPoint] as number;
      const golden = goldenAtLatest ? (goldenAtLatest[cfg.key as keyof typeof goldenAtLatest] as number) : current;

      // Fixed band width as a fallback only, before the envelope has loaded -
      // the real, data-derived offset from fetchGoldenEnvelope takes over
      // as soon as it's available.
      const fallbackHalfWidth = (cfg.upper_limit - cfg.lower_limit) / 2;
      const lowerOffset = envelopeAtLatest
        ? (envelopeAtLatest[`${cfg.key}_lower_offset` as keyof GoldenEnvelopePoint] as number)
        : -fallbackHalfWidth;
      const upperOffset = envelopeAtLatest
        ? (envelopeAtLatest[`${cfg.key}_upper_offset` as keyof GoldenEnvelopePoint] as number)
        : fallbackHalfWidth;
      const effectiveLower = Math.round((golden + lowerOffset) * 100) / 100;
      const effectiveUpper = Math.round((golden + upperOffset) * 100) / 100;

      const livePred = mode === 'running'
        ? runningTelemetry?.prediction?.parameters.find((p) => p.key === cfg.key)
        : undefined;
      const goldenFuture = goldenAt30 ? (goldenAt30[cfg.key as keyof typeof goldenAt30] as number) : undefined;
      return {
        key: cfg.key,
        label: cfg.label,
        unit: cfg.unit,
        current,
        golden,
        lowerLimit: effectiveLower,
        upperLimit: effectiveUpper,
        status: classifyStatus(current, effectiveLower, effectiveUpper),
        prediction: livePred
          ? { predicted: livePred.predicted, goldenFuture, alertLevel: livePred.alert_level }
          : undefined,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestPoint, paramConfig, goldenTimeline, goldenEnvelope, mode, runningTelemetry]);

  useEffect(() => {
    if (paramCards.length > 0 && !paramCards.find((p) => p.key === activeParamKey)) {
      setActiveParamKey(paramCards[0].key);
    }
  }, [paramCards, activeParamKey]);

  const activeParamObj = paramCards.find((p) => p.key === activeParamKey) ?? paramCards[0];

  const chartData = useMemo(() => {
    return points.map((p) => {
      const golden = goldenPointAt(p.elapsed_minutes);
      const point: Record<string, number> = {
        elapsed_minutes: p.elapsed_minutes,
        [activeParamKey]: p[activeParamKey as keyof NormalizedPoint] as number,
      };
      if (golden) point[`golden_${activeParamKey}`] = golden[activeParamKey as keyof typeof golden] as number;
      return point;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, activeParamKey, goldenTimeline]);

  const stats = useMemo(() => {
    if (points.length === 0) return { avg: 0, min: 0, max: 0, variance: 0, stdDev: 0 };
    const values = points.map((p) => p[activeParamKey as keyof NormalizedPoint] as number);
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const variance = values.reduce((a, b) => a + (b - avg) ** 2, 0) / values.length;
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      avg: round(avg),
      min: round(Math.min(...values)),
      max: round(Math.max(...values)),
      variance: round(variance),
      stdDev: round(Math.sqrt(variance)),
    };
  }, [points, activeParamKey]);

  const getAiMessage = () => {
    if (!activeParamObj) return '';
    const diff = (activeParamObj.current - activeParamObj.golden).toFixed(2);
    const sign = Number(diff) > 0 ? '+' : '';
    if (activeParamObj.status === 'normal') {
      return `${activeParamObj.label} is operating normally with a deviation of ${sign}${diff} ${activeParamObj.unit} from the golden batch reference at this point in the run.`;
    } else if (activeParamObj.status === 'warning') {
      return `${activeParamObj.label} is drifting from the golden reference (${sign}${diff} ${activeParamObj.unit}) and is nearing the control limits. Close observation is recommended.`;
    }
    return `Critical deviation detected in ${activeParamObj.label} (${sign}${diff} ${activeParamObj.unit} from golden). Process has exceeded expected bounds.`;
  };

  const handleStop = () => {
    if (!selectedRunningBatchId) return;
    stopRunningBatch(selectedRunningBatchId).then((updated) => {
      setRunningBatches((prev) => prev.map((b) => (b.running_batch_id === updated.running_batch_id ? updated : b)));
    });
  };

  const activeLoading = mode === 'running' ? runningBatchesLoading : batchesLoading;
  const activeError = mode === 'running' ? runningBatchesError : batchesError;

  const ModeToggle = (
    <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
      <button
        onClick={() => setMode('running')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
          mode === 'running' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        <Radio size={13} /> Running Batches
      </button>
      <button
        onClick={() => setMode('completed')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
          mode === 'completed' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        <History size={13} /> Completed Batches
      </button>
    </div>
  );

  if (activeLoading) {
    return (
      <div className="max-w-7xl mx-auto flex flex-col items-center justify-center h-96 gap-3 text-gray-500">
        <Loader2 className="animate-spin" size={28} />
        <p className="text-sm font-medium">Loading batches from the process API…</p>
      </div>
    );
  }

  if (activeError) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 flex items-start gap-3">
          <AlertTriangle className="text-red-500 mt-0.5 shrink-0" size={20} />
          <div>
            <h2 className="text-sm font-bold text-red-800">Could not load batches</h2>
            <p className="text-xs text-red-700 mt-1 leading-relaxed">{activeError}</p>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'running' && runningBatches.length === 0) {
    return (
      <div className="max-w-7xl mx-auto space-y-4">
        {ModeToggle}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center text-sm text-gray-500">
          No running batches right now.
        </div>
      </div>
    );
  }

  if (mode === 'completed' && batches.length === 0) {
    return (
      <div className="max-w-7xl mx-auto space-y-4">
        {ModeToggle}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center text-sm text-gray-500">
          No batches available.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between md:items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Process Monitoring</h1>
          {mode === 'running' ? (
            <>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-sm text-gray-500">Live simulated telemetry for</p>
                <select
                  value={selectedRunningBatchId ?? ''}
                  onChange={(e) => setSelectedRunningBatchId(e.target.value)}
                  className="bg-gray-50 border border-gray-200 text-sm text-gray-700 rounded font-medium px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                >
                  {runningBatches.map((b) => (
                    <option key={b.running_batch_id} value={b.running_batch_id}>
                      {b.running_batch_id} — {b.scenario_profile} ({b.status})
                    </option>
                  ))}
                </select>
                {selectedRunningBatch && <p className="text-sm text-gray-500">at {selectedRunningBatch.plant}</p>}
              </div>
              {selectedRunningBatch && (
                <p className="text-xs text-gray-400 mt-1 flex items-center font-medium gap-1.5 flex-wrap">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Simulated live feed
                  <span>· {selectedRunningBatch.elapsed_minutes} / {selectedRunningBatch.target_duration_minutes} min</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${SCENARIO_BADGE[selectedRunningBatch.scenario_profile] ?? 'bg-gray-100 text-gray-700'}`}>
                    {selectedRunningBatch.scenario_profile} scenario
                  </span>
                </p>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-sm text-gray-500">Real recorded parameters and control charting for</p>
                <select
                  value={selectedBatchId ?? ''}
                  onChange={(e) => setSelectedBatchId(e.target.value)}
                  className="bg-gray-50 border border-gray-200 text-sm text-gray-700 rounded font-medium px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                >
                  {batches.map((b) => (
                    <option key={b.batch_id} value={b.batch_id}>{b.batch_id}</option>
                  ))}
                </select>
                {selectedBatch && <p className="text-sm text-gray-500">at {selectedBatch.plant}</p>}
              </div>
              <p className="text-xs text-gray-400 mt-1 flex items-center font-medium gap-1">
                <History size={12} /> Historical batch record (not a live feed) — {timeline?.batch_duration_minutes ?? '—'} min total
              </p>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {mode === 'running' && selectedRunningBatch?.status === 'Running' && (
            <button
              onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 transition-colors"
            >
              <Square size={12} /> Stop batch
            </button>
          )}
          {ModeToggle}
        </div>
      </div>

      {mode === 'completed' && timelineError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="text-red-500 mt-0.5 shrink-0" size={18} />
          <p className="text-xs text-red-700 leading-relaxed">{timelineError}</p>
        </div>
      )}

      <div className={mode === 'completed' && timelineLoading ? 'opacity-50 pointer-events-none transition-opacity' : 'transition-opacity'}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {paramCards.map((param) => {
            const dev = param.current - param.golden;
            return (
              <div key={param.key} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 relative overflow-hidden">
                <div className="flex justify-between items-start mb-4">
                  <span className="text-sm font-medium text-gray-500">{param.label}</span>
                  <span className={`w-3 h-3 rounded-full ${STATUS_DOT[param.status]}`}></span>
                </div>
                <div className="text-2xl font-bold text-gray-900 mb-1">{param.current} {param.unit}</div>
                <div className="text-sm text-gray-500 flex justify-between">
                  <span>Golden: {param.golden}</span>
                  <span className={`font-medium ${dev > 0 ? 'text-rose-600' : dev < 0 ? 'text-indigo-600' : 'text-gray-600'}`}>
                    Dev: {dev > 0 ? '+' : ''}{dev.toFixed(2)}
                  </span>
                </div>
                {mode === 'running' && (
                  param.prediction ? (
                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
                      <div className="flex justify-between items-baseline">
                        <span className="text-[10px] text-gray-400 uppercase font-semibold">Predicted (+30m)</span>
                        <span className="text-sm font-bold text-indigo-600">{param.prediction.predicted} {param.unit}</span>
                      </div>
                      {param.prediction.goldenFuture !== undefined && (
                        <div className="flex justify-between items-baseline">
                          <span className="text-[10px] text-gray-400 uppercase font-semibold">Golden (+30m)</span>
                          <span className="text-[11px] font-mono text-gray-500">
                            {param.prediction.goldenFuture}
                            {' · '}
                            <span className={
                              param.prediction.predicted - param.prediction.goldenFuture > 0 ? 'text-rose-600'
                                : param.prediction.predicted - param.prediction.goldenFuture < 0 ? 'text-indigo-600'
                                : 'text-gray-500'
                            }>
                              Dev: {param.prediction.predicted - param.prediction.goldenFuture > 0 ? '+' : ''}
                              {(param.prediction.predicted - param.prediction.goldenFuture).toFixed(2)}
                            </span>
                          </span>
                        </div>
                      )}
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${PREDICTED_ALERT_BADGE[param.prediction.alertLevel]}`}>
                        Predicted: {param.prediction.alertLevel}
                      </span>
                    </div>
                  ) : (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <span className="text-[10px] text-gray-400 italic">
                        Forecast available once 30 min of history exist ({selectedRunningBatch?.elapsed_minutes ?? 0}/30 min)
                      </span>
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>

        {activeParamObj && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 flex flex-col">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-lg font-semibold text-gray-800">Parameter Trend Comparison</h2>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Parameter:</span>
                    <select
                      value={activeParamKey}
                      onChange={(e) => setActiveParamKey(e.target.value)}
                      className="bg-gray-50 border border-gray-200 text-sm text-gray-800 rounded-md py-1.5 px-3 outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                    >
                      {paramCards.map((p) => (
                        <option key={p.key} value={p.key}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="h-80 w-full relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                      <XAxis dataKey="elapsed_minutes" stroke="#9ca3af" fontSize={12} tickMargin={10} minTickGap={20} label={{ value: 'Elapsed minutes', position: 'insideBottom', offset: -3, fontSize: 11 }} />
                      <YAxis
                        domain={['dataMin - ' + (activeParamObj.upperLimit - activeParamObj.lowerLimit) * 0.2, 'dataMax + ' + (activeParamObj.upperLimit - activeParamObj.lowerLimit) * 0.2]}
                        stroke="#6b7280"
                        fontSize={12}
                        tickFormatter={(val) => (typeof val === 'number' ? val.toFixed(1) : val)}
                      />
                      <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px', paddingBottom: '10px' }} />
                      <ReferenceArea y1={activeParamObj.lowerLimit} y2={activeParamObj.upperLimit} fill="#10b981" fillOpacity={0.08} />
                      <Line type="monotone" dataKey={activeParamKey} name={`Current ${activeParamObj.label}`} stroke="#3b82f6" strokeWidth={2.5} dot={false} activeDot={{ r: 6 }} />
                      <Line type="monotone" dataKey={`golden_${activeParamKey}`} name={`Golden ${activeParamObj.label}`} stroke="#eab308" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 flex flex-col">
                <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wider mb-4 border-b border-gray-100 pb-2 flex items-center gap-2">
                  <Info size={16} className="text-blue-500" /> {activeParamObj.label} Statistics ({mode === 'running' ? 'Live Readings So Far' : 'Full Batch Record'})
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="bg-gray-50 border border-gray-100 p-3 rounded-lg flex flex-col items-center justify-center">
                    <span className="text-xs text-gray-500 mb-1">Average</span>
                    <span className="font-semibold text-gray-900">{stats.avg}</span>
                  </div>
                  <div className="bg-gray-50 border border-gray-100 p-3 rounded-lg flex flex-col items-center justify-center">
                    <span className="text-xs text-gray-500 mb-1">Std Dev</span>
                    <span className="font-semibold text-gray-900">{stats.stdDev}</span>
                  </div>
                  <div className="bg-gray-50 border border-gray-100 p-3 rounded-lg flex flex-col items-center justify-center">
                    <span className="text-xs text-gray-500 mb-1">Variance</span>
                    <span className="font-semibold text-gray-900">{stats.variance}</span>
                  </div>
                  <div className="bg-gray-50 border border-gray-100 p-3 rounded-lg flex flex-col items-center justify-center">
                    <span className="text-xs text-gray-500 mb-1">Minimum</span>
                    <span className="font-semibold text-gray-900">{stats.min}</span>
                  </div>
                  <div className="bg-gray-50 border border-gray-100 p-3 rounded-lg flex flex-col items-center justify-center">
                    <span className="text-xs text-gray-500 mb-1">Maximum</span>
                    <span className="font-semibold text-gray-900">{stats.max}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-blue-50/50 rounded-lg shadow-sm border border-blue-100 p-6 h-fit">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
                <BrainCircuit className="text-blue-600" /> AI Observation
              </h2>
              <div className={`p-4 rounded-xl border ${activeParamObj.status === 'normal' ? 'bg-white border-gray-200 text-gray-700' : activeParamObj.status === 'warning' ? 'bg-yellow-50 border-yellow-200 text-yellow-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                <p className="text-sm leading-relaxed font-medium">
                  {getAiMessage()}
                </p>
                <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-widest pt-4 border-t border-gray-100/30">
                  Expected Range (vs. golden, this minute):
                  <span className="bg-white/50 px-2 py-0.5 rounded border border-gray-200/50">
                    {activeParamObj.lowerLimit} - {activeParamObj.upperLimit} {activeParamObj.unit}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
