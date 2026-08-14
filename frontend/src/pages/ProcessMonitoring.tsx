import { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart, Line, ReferenceArea, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import {
  Info, Loader2, AlertTriangle, Square, Bot,
  CheckCircle2, XCircle, ArrowUp, ArrowDown, Minus, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  fetchTimeline, fetchParameterConfig, fetchGoldenEnvelope, GOLDEN_BATCH_ID,
  fetchRunningBatches, fetchRunningBatchTelemetry, stopRunningBatch,
  fetchAiMode, setAiMode, fetchTickIntervalSeconds,
} from '../lib/api';
import type {
  TimelineResponse, ParameterConfigEntry, GoldenEnvelopePoint,
  RunningBatchSummary, RunningBatchTelemetryResponse, AIMode,
} from '../lib/api';

const WARNING_MARGIN_FRACTION = 0.15;
const LIVE_POLL_INTERVAL_MS = 3000;
const HISTORY_MINUTES = 10;

type Status = 'normal' | 'warning' | 'critical';

// This page only ever shows running batches now (Completed Batches mode was
// removed as redundant - Batch Explorer already covers browsing finished
// batches, and this page's whole point is watching something live).
interface NormalizedPoint {
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
  status: Status;
  // Live ML forecast for this parameter, 30 minutes ahead - undefined until
  // the running batch has 30+ minutes of history.
  prediction?: {
    predicted: number;
    // Golden batch's own reading 30 minutes from now (not "now") - the
    // predicted value is a future value, so it's compared against golden's
    // future value, the same "moving reference" idea as the current-value
    // Golden/Dev line above, just shifted forward by the forecast horizon.
    goldenFuture: number | undefined;
    alertLevel: 'Normal' | 'Warning' | 'Critical';
    // Golden(t+30) +/- data-derived offset AT t+30 - same dynamic-band idea
    // as the card's own lowerLimit/upperLimit above, just evaluated 30
    // minutes ahead so the displayed "Predicted Range" matches the same
    // reference frame the forecast's own alert level is judged against.
    lowerLimit: number;
    upperLimit: number;
  };
}

const classifyStatus = (value: number, lo: number, hi: number): Status => {
  if (value < lo || value > hi) return 'critical';
  const margin = (hi - lo) * WARNING_MARGIN_FRACTION;
  if (value < lo + margin || value > hi - margin) return 'warning';
  return 'normal';
};

const SEVERITY_RANK: Record<Status, number> = { normal: 0, warning: 1, critical: 2 };

const STATUS_DOT: Record<Status, string> = {
  normal: 'bg-green-500',
  warning: 'bg-yellow-500',
  critical: 'bg-red-500',
};

const HEADLINE_STYLE: Record<Status, { bg: string; border: string; text: string; label: string; Icon: typeof CheckCircle2 }> = {
  normal: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800', label: 'On Track', Icon: CheckCircle2 },
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', label: 'Needs Attention', Icon: AlertTriangle },
  critical: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', label: 'Deviating', Icon: XCircle },
};

const PREDICTED_ALERT_BADGE: Record<string, string> = {
  Normal: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Warning: 'bg-amber-50 text-amber-700 border-amber-200',
  Critical: 'bg-red-50 text-red-700 border-red-200',
};

const AGENT_STATUS_BADGE: Record<Status, string> = {
  normal: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-800',
  critical: 'bg-red-100 text-red-800',
};

const CONFIDENCE_STYLE: Record<string, string> = {
  High: 'text-emerald-700',
  Medium: 'text-amber-700',
  Low: 'text-gray-500',
};

const TRIGGER_LABEL: Record<string, string> = {
  current: 'Active deviation',
  predicted: 'Forecasted deviation',
  both: 'Active + forecasted deviation',
};

// Urgency is the LLM reasoning layer's operational-priority call (Azure
// OpenAI, synthesized from the deterministic evidence) - most-to-least
// urgent, styled to read at a glance.
const URGENCY_STYLE: Record<string, string> = {
  'Immediate Action Required': 'bg-red-600 text-white',
  'Action Recommended Soon': 'bg-amber-500 text-white',
  'Monitor Closely': 'bg-amber-100 text-amber-800',
  'Informational Only': 'bg-gray-100 text-gray-600',
};

export default function ProcessMonitoring() {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  const [runningBatches, setRunningBatches] = useState<RunningBatchSummary[]>([]);
  const [runningBatchesLoading, setRunningBatchesLoading] = useState(true);
  const [runningBatchesError, setRunningBatchesError] = useState<string | null>(null);
  const [selectedRunningBatchId, setSelectedRunningBatchId] = useState<string | null>(null);
  const [runningTelemetry, setRunningTelemetry] = useState<RunningBatchTelemetryResponse | null>(null);

  // --- Shared reference data ---
  const [paramConfig, setParamConfig] = useState<ParameterConfigEntry[]>([]);
  const [goldenTimeline, setGoldenTimeline] = useState<TimelineResponse | null>(null);
  const [goldenEnvelope, setGoldenEnvelope] = useState<GoldenEnvelopePoint[]>([]);
  const [activeParamKey, setActiveParamKey] = useState('temperature');
  // Scrolled into view when a parameter card is clicked, so the chart/Agent
  // Assessment section (which renders below the card grid) is immediately
  // visible instead of requiring a manual scroll - especially relevant now
  // that 12 cards push this section further down the page than the
  // original 4 did.
  const detailSectionRef = useRef<HTMLDivElement | null>(null);

  // AI Analysis Mode - a global backend switch (see backend/app/live/ai_mode.py),
  // not per-batch. Defaults to Static until the real value loads, matching
  // the backend's own default so there's no flash of the wrong state.
  const [aiMode, setAiModeState] = useState<AIMode>('static');
  const [aiModeUpdating, setAiModeUpdating] = useState(false);

  // Real backend tick cadence (seconds of wall-clock time per simulated
  // minute) - fetched once so the displayed cadence can't drift out of sync
  // with backend/app/live/config.py's actual speed profile.
  const [tickIntervalSeconds, setTickIntervalSeconds] = useState<number | null>(null);

  const selectedRunningBatch = runningBatches.find((b) => b.running_batch_id === selectedRunningBatchId) ?? null;

  useEffect(() => {
    fetchParameterConfig().then(setParamConfig).catch(() => setParamConfig([]));
    fetchTimeline(GOLDEN_BATCH_ID).then(setGoldenTimeline).catch(() => setGoldenTimeline(null));
    fetchGoldenEnvelope().then(setGoldenEnvelope).catch(() => setGoldenEnvelope([]));
    fetchAiMode().then((r) => setAiModeState(r.mode)).catch(() => {});
    fetchTickIntervalSeconds().then((r) => setTickIntervalSeconds(r.tick_interval_seconds)).catch(() => {});
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
    if (!selectedRunningBatchId) return;
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
  }, [selectedRunningBatchId]);

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

  const points: NormalizedPoint[] = useMemo(() => runningTelemetry?.points ?? [], [runningTelemetry]);

  const latestPoint = points.length > 0 ? points[points.length - 1] : null;

  // Same golden(t)+/-margin(t) band used for the param cards above, just
  // evaluated at an arbitrary historical minute instead of only the latest
  // one - lets each row of the History table tint its own cells correctly.
  const statusAt = (point: NormalizedPoint, cfg: ParameterConfigEntry): Status => {
    const value = point[cfg.key as keyof NormalizedPoint] as number;
    const golden = goldenPointAt(point.elapsed_minutes);
    const goldenValue = golden ? (golden[cfg.key as keyof typeof golden] as number) : value;
    const envelope = envelopeAt(point.elapsed_minutes);
    const fallbackHalfWidth = (cfg.upper_limit - cfg.lower_limit) / 2;
    const lowerOffset = envelope ? (envelope[`${cfg.key}_lower_offset` as keyof GoldenEnvelopePoint] as number) : -fallbackHalfWidth;
    const upperOffset = envelope ? (envelope[`${cfg.key}_upper_offset` as keyof GoldenEnvelopePoint] as number) : fallbackHalfWidth;
    return classifyStatus(value, goldenValue + lowerOffset, goldenValue + upperOffset);
  };

  // Newest-first, capped to the last HISTORY_MINUTES readings.
  const historyRows = useMemo(() => [...points].slice(-HISTORY_MINUTES).reverse(), [points]);

  const paramCards: ParamCard[] = useMemo(() => {
    if (!latestPoint || paramConfig.length === 0) return [];
    const goldenAtLatest = goldenPointAt(latestPoint.elapsed_minutes);
    const envelopeAtLatest = envelopeAt(latestPoint.elapsed_minutes);
    const goldenAt30 = goldenPointAt(latestPoint.elapsed_minutes + 30);
    const envelopeAt30 = envelopeAt(latestPoint.elapsed_minutes + 30);

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

      const livePred = runningTelemetry?.prediction?.parameters.find((p) => p.key === cfg.key);
      const goldenFuture = goldenAt30 ? (goldenAt30[cfg.key as keyof typeof goldenAt30] as number) : undefined;
      const lowerOffset30 = envelopeAt30
        ? (envelopeAt30[`${cfg.key}_lower_offset` as keyof GoldenEnvelopePoint] as number)
        : -fallbackHalfWidth;
      const upperOffset30 = envelopeAt30
        ? (envelopeAt30[`${cfg.key}_upper_offset` as keyof GoldenEnvelopePoint] as number)
        : fallbackHalfWidth;
      const predictedLower = goldenFuture !== undefined ? Math.round((goldenFuture + lowerOffset30) * 100) / 100 : effectiveLower;
      const predictedUpper = goldenFuture !== undefined ? Math.round((goldenFuture + upperOffset30) * 100) / 100 : effectiveUpper;
      // The "In 30 min" badge uses the Deviation Agent's own predicted_status
      // (dynamic Golden(t+30)+/-Margin(t+30), see deviation_agent.py) rather
      // than livePred.alert_level (the ML's raw fixed-parameter-config-band
      // read) - otherwise this badge and the Agent Assessment panel could
      // show two different severities for the same prediction. Falls back to
      // the fixed-band read only if the assessment isn't available yet,
      // which shouldn't normally happen since both gate on the same 30-
      // minute history requirement.
      const liveAssessment = runningTelemetry?.assessments.find((a) => a.key === cfg.key);
      const dynamicPredictedLevel = liveAssessment?.predicted_status
        ? ((liveAssessment.predicted_status.charAt(0).toUpperCase() + liveAssessment.predicted_status.slice(1)) as 'Normal' | 'Warning' | 'Critical')
        : livePred?.alert_level;
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
          ? {
              predicted: livePred.predicted,
              goldenFuture,
              alertLevel: dynamicPredictedLevel ?? livePred.alert_level,
              lowerLimit: predictedLower,
              upperLimit: predictedUpper,
            }
          : undefined,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestPoint, paramConfig, goldenTimeline, goldenEnvelope, runningTelemetry]);

  useEffect(() => {
    if (paramCards.length > 0 && !paramCards.find((p) => p.key === activeParamKey)) {
      setActiveParamKey(paramCards[0].key);
    }
  }, [paramCards, activeParamKey]);

  const activeParamObj = paramCards.find((p) => p.key === activeParamKey) ?? paramCards[0];

  // Process Parameter Deviation Agent output for the currently-selected parameter.
  const activeAssessment = runningTelemetry?.assessments.find((a) => a.key === activeParamKey);

  const assessmentAlertStatus: Status = activeAssessment
    ? (SEVERITY_RANK[activeAssessment.current_status] >= SEVERITY_RANK[(activeAssessment.predicted_status ?? 'normal') as Status]
      ? activeAssessment.current_status
      : (activeAssessment.predicted_status as Status))
    : 'normal';

  // Worst status across every parameter, current AND predicted - the single
  // headline number a presenter points to first, before drilling into any
  // one parameter's detail.
  const overallStatus: Status = useMemo(() => {
    let worst: Status = 'normal';
    for (const p of paramCards) {
      if (SEVERITY_RANK[p.status] > SEVERITY_RANK[worst]) worst = p.status;
      if (p.prediction) {
        const predStatus = p.prediction.alertLevel.toLowerCase() as Status;
        if (SEVERITY_RANK[predStatus] > SEVERITY_RANK[worst]) worst = predStatus;
      }
    }
    return worst;
  }, [paramCards]);

  const headlineMessage = useMemo(() => {
    if (paramCards.length === 0) return '';
    if (overallStatus === 'normal') return 'All parameters are tracking close to the ideal recipe.';
    const worst = paramCards.find((p) => p.status !== 'normal')
      ?? paramCards.find((p) => p.prediction && p.prediction.alertLevel !== 'Normal');
    if (!worst) return '';
    const isOffNow = worst.status !== 'normal';
    if (overallStatus === 'critical') {
      return isOffNow
        ? `${worst.label} has moved outside the expected range for this point in the batch.`
        : `${worst.label} looks fine right now, but is predicted to move outside the expected range within 30 minutes.`;
    }
    return isOffNow
      ? `${worst.label} is drifting from the ideal profile and is worth keeping an eye on.`
      : `${worst.label} is expected to start drifting from the ideal profile within the next 30 minutes.`;
  }, [paramCards, overallStatus]);

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

  const handleStop = () => {
    if (!selectedRunningBatchId) return;
    stopRunningBatch(selectedRunningBatchId).then((updated) => {
      setRunningBatches((prev) => prev.map((b) => (b.running_batch_id === updated.running_batch_id ? updated : b)));
    });
  };

  const handleToggleAiMode = () => {
    const next: AIMode = aiMode === 'static' ? 'agent_llm' : 'static';
    setAiModeUpdating(true);
    setAiMode(next)
      .then((r) => setAiModeState(r.mode))
      .catch(() => {})
      .finally(() => setAiModeUpdating(false));
  };

  if (runningBatchesLoading) {
    return (
      <div className="max-w-7xl mx-auto flex flex-col items-center justify-center h-96 gap-3 text-gray-500">
        <Loader2 className="animate-spin" size={28} />
        <p className="text-sm font-medium">Loading batches from the process API…</p>
      </div>
    );
  }

  if (runningBatchesError) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 flex items-start gap-3">
          <AlertTriangle className="text-red-500 mt-0.5 shrink-0" size={20} />
          <div>
            <h2 className="text-sm font-bold text-red-800">Could not load batches</h2>
            <p className="text-xs text-red-700 mt-1 leading-relaxed">{runningBatchesError}</p>
          </div>
        </div>
      </div>
    );
  }

  if (runningBatches.length === 0) {
    return (
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center text-sm text-gray-500">
          No running batches right now.
        </div>
      </div>
    );
  }

  const headline = HEADLINE_STYLE[overallStatus];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between md:items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Process Monitoring</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-gray-500">Live telemetry for</p>
            <select
              value={selectedRunningBatchId ?? ''}
              onChange={(e) => setSelectedRunningBatchId(e.target.value)}
              className="bg-gray-50 border border-gray-200 text-sm text-gray-700 rounded font-medium px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              {/* scenario_profile deliberately not shown here - it's a
                  simulation input (what fault was scripted in before the
                  batch started), not something an operator would know in
                  advance. Showing it would spoil what the Deviation Agent
                  is meant to discover from telemetry as it happens. */}
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
              live feed
              {tickIntervalSeconds != null && (
                <span>· Updates every {Number.isInteger(tickIntervalSeconds) ? tickIntervalSeconds : tickIntervalSeconds.toFixed(1)}s</span>
              )}
              <span>· {selectedRunningBatch.elapsed_minutes} / {selectedRunningBatch.target_duration_minutes} min</span>
            </p>
          )}
        </div>
        <div className="flex items-end gap-2 self-start">
          {/* Global switch (backend/app/live/ai_mode.py) - Static (default)
              uses deterministic historical-match reasoning with no LLM
              calls; Agent LLM Mode calls the real AI agent for Warning/
              Critical deviations. In production this toggle would be
              hidden/removed and the mode set once via config instead. */}
          <div className="flex flex-col items-end">
            <span className="text-2xs font-bold text-gray-400 uppercase tracking-wider mb-1">AI Analysis Mode</span>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold transition-colors ${aiMode === 'static' ? 'text-gray-700' : 'text-gray-400'}`}>Static</span>
              <button
                type="button"
                role="switch"
                aria-checked={aiMode === 'agent_llm'}
                onClick={handleToggleAiMode}
                disabled={aiModeUpdating}
                title={aiMode === 'static'
                  ? 'Static: deterministic historical-match reasoning, no LLM calls. Click to turn on Agent LLM Mode.'
                  : 'Agent LLM Mode: real AI agent reasoning for Warning/Critical deviations. Click to turn off.'}
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
          {selectedRunningBatch?.status === 'Running' && (
            <button
              onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 transition-colors"
            >
              <Square size={12} /> Stop batch
            </button>
          )}
        </div>
      </div>

      <div>
        {/* Headline batch health - the one thing to point at first */}
        {paramCards.length > 0 && (
          <div className={`rounded-xl border p-5 flex items-center gap-4 mb-6 ${headline.bg} ${headline.border}`}>
            <headline.Icon size={32} className={headline.text} />
            <div>
              <div className={`text-lg font-bold ${headline.text}`}>{headline.label}</div>
              <p className={`text-sm ${headline.text} opacity-90`}>{headlineMessage}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {paramCards.map((param) => {
            const dev = param.current - param.golden;
            // Dot is current status ONLY - the "In 30 min" row below already
            // carries the predicted value and predicted severity, so the dot
            // deliberately doesn't also try to reflect the forecast. Keeps
            // the two questions separate: dot answers "how is it now?",
            // the row answers "what's expected next?" - not one indicator
            // trying to answer both.
            const isSelected = param.key === activeParamKey;
            return (
            <button
              key={param.key}
              type="button"
              onClick={() => {
                setActiveParamKey(param.key);
                detailSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className={`w-full text-left bg-white rounded-lg shadow-sm border p-5 relative overflow-hidden transition-all hover:shadow-md ${
                isSelected ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-gray-200 hover:border-indigo-200'
              }`}
            >
              <div className="flex justify-between items-start mb-1 gap-2 min-w-0">
                <span className="text-sm font-medium text-gray-500 truncate">{param.label}</span>
                <span className={`w-3 h-3 rounded-full shrink-0 ${STATUS_DOT[param.status]}`}></span>
              </div>
              <span className="text-2xs font-bold text-gray-400 uppercase tracking-wider">Actual</span>
              <div className="text-2xl font-bold text-gray-900">{param.current} {param.unit}</div>
              <div className="mt-2 text-sm text-gray-500 flex justify-between">
                <span>Golden Batch: {param.golden}</span>
                <span className={`font-medium ${dev > 0 ? 'text-rose-600' : dev < 0 ? 'text-indigo-600' : 'text-gray-600'}`}>
                  Dev: {dev > 0 ? '+' : ''}{dev.toFixed(2)}
                </span>
              </div>

              {param.prediction ? (
                <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
                  <span className="text-2xs text-gray-500 font-medium flex items-center gap-1 shrink-0">
                    {param.prediction.predicted > param.current
                      ? <ArrowUp size={12} className="text-rose-500" />
                      : param.prediction.predicted < param.current
                      ? <ArrowDown size={12} className="text-indigo-500" />
                      : <Minus size={12} className="text-gray-400" />}
                    Predicted (30 min)
                  </span>
                  <span className="text-sm font-bold text-gray-800 shrink-0">{param.prediction.predicted} {param.unit}</span>
                  <span className={`px-2 py-0.5 rounded-full text-2xs font-bold border shrink-0 ${PREDICTED_ALERT_BADGE[param.prediction.alertLevel]}`}>
                    {param.prediction.alertLevel}
                  </span>
                </div>
              ) : (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <span className="text-2xs text-gray-400 italic">
                    Forecast available once 30 min of history exist ({selectedRunningBatch?.elapsed_minutes ?? 0}/30 min)
                  </span>
                </div>
              )}
            </button>
            );
          })}
        </div>

        {activeParamObj && (
          <div ref={detailSectionRef} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 flex flex-col">
                <div className="flex justify-between items-center mb-2">
                  <h2 className="text-lg font-semibold text-gray-800">Parameter Trend Comparison</h2>
                  {/* Parameter is picked by clicking a card above - no
                      separate selector here, just a label confirming which
                      one this chart (and Technical Details, and Agent
                      Assessment) is currently showing. */}
                  <span className="bg-indigo-50 text-indigo-700 text-xs font-semibold px-2.5 py-1 rounded-md border border-indigo-100">
                    {activeParamObj.label}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mb-4">
                  The dashed gold line is what an ideal batch looked like at this same point in time.
                </p>
                {/* Always rendered here (not inside the Agent Assessment /
                    "What This Means" panel on the right) so the expected
                    range stays visible no matter which of those two panels
                    happens to be showing - the ranges are themselves
                    time-varying (Golden(t) +/- data-derived margin), so
                    "Current" and "Predicted" show two different windows in
                    time, not the same number twice. */}
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200 rounded-full px-3 py-1">
                    Current Range
                    <span className="font-bold text-gray-800">{activeParamObj.lowerLimit} - {activeParamObj.upperLimit} {activeParamObj.unit}</span>
                  </span>
                  {activeParamObj.prediction && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-full px-3 py-1">
                      Predicted Range
                      <span className="font-bold text-indigo-800">
                        {activeParamObj.prediction.lowerLimit} - {activeParamObj.prediction.upperLimit} {activeParamObj.unit}
                      </span>
                    </span>
                  )}
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
                      <Line type="monotone" dataKey={`golden_${activeParamKey}`} name={`Golden Batch ${activeParamObj.label}`} stroke="#eab308" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* History table - reference/detail content, paired with
                  Technical Details below rather than competing for space
                  in the immediately-visible Agent Assessment column. */}
              {paramConfig.length > 0 && historyRows.length > 0 && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                  <h2 className="text-sm font-semibold text-gray-800 mb-3">
                    History <span className="text-xs font-normal text-gray-400">(last {HISTORY_MINUTES} min)</span>
                  </h2>
                  <div className="overflow-y-auto max-h-72">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="text-gray-400 text-2xs uppercase tracking-wide">
                          <th className="text-left font-semibold px-1.5 py-1">Min</th>
                          {paramConfig.map((cfg) => (
                            <th key={cfg.key} className="text-right font-semibold px-1.5 py-1">{cfg.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {historyRows.map((row, idx) => (
                          <tr key={row.elapsed_minutes} className={idx === 0 ? 'bg-indigo-50' : ''}>
                            <td className={`px-1.5 py-1 font-medium ${idx === 0 ? 'text-indigo-700' : 'text-gray-500'}`}>{row.elapsed_minutes}</td>
                            {paramConfig.map((cfg) => {
                              const status = statusAt(row, cfg);
                              const value = row[cfg.key as keyof NormalizedPoint] as number;
                              return (
                                <td
                                  key={cfg.key}
                                  className={`px-1.5 py-1 text-right ${
                                    status === 'critical' ? 'text-red-600 font-semibold' : status === 'warning' ? 'text-amber-600 font-medium' : 'text-gray-700'
                                  }`}
                                >
                                  {value.toFixed(2)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <button
                  onClick={() => setShowTechnicalDetails((v) => !v)}
                  className="w-full flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wider"
                >
                  <span className="flex items-center gap-2">
                    <Info size={14} className="text-blue-500" /> Technical Details ({activeParamObj.label})
                  </span>
                  {showTechnicalDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {showTechnicalDetails && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 mt-4 pt-4 border-t border-gray-100">
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
                )}
              </div>
            </div>

            {/* Agent Assessment / What This Means - back in its own column,
                immediately visible with nothing competing above it. */}
            <div className="space-y-6">
              {activeAssessment ? (
              <div className="bg-blue-50/50 rounded-lg shadow-sm border border-blue-100 p-6 h-fit">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <Bot className="text-blue-600" /> Agent Assessment
                  </h2>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${AGENT_STATUS_BADGE[assessmentAlertStatus]}`}>
                    {assessmentAlertStatus}
                  </span>
                </div>

                {activeAssessment.trigger_type && (
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="text-2xs font-bold text-indigo-600 uppercase tracking-wider bg-indigo-50 border border-indigo-100 rounded px-2 py-1 inline-block">
                      {TRIGGER_LABEL[activeAssessment.trigger_type]}
                    </span>
                    {/* Both modes render this panel identically otherwise -
                        this is the one honest signal of which path actually
                        produced the text below (see app.live.ai_mode /
                        llm_agent.generate_alert_reasoning), not a guess. */}
                    {activeAssessment.reasoning_source && (
                      <span
                        title={activeAssessment.reasoning_source === 'llm'
                          ? 'This explanation was generated by the real AI agent (Azure OpenAI).'
                          : 'This explanation is a deterministic template, not AI-generated.'}
                        className={`text-2xs font-bold uppercase tracking-wider rounded px-2 py-1 inline-flex items-center gap-1 border ${
                          activeAssessment.reasoning_source === 'llm'
                            ? 'text-purple-700 bg-purple-50 border-purple-100'
                            : 'text-gray-500 bg-gray-100 border-gray-200'
                        }`}
                      >
                        {activeAssessment.reasoning_source === 'llm' ? <Bot size={11} /> : <Info size={11} />}
                        {activeAssessment.reasoning_source === 'llm' ? 'AI Generated' : 'Static Template'}
                      </span>
                    )}
                  </div>
                )}

                {/* 1-2: what triggered + severity, synthesized by the LLM
                    reasoning layer into one sentence (alert_summary is
                    generated alongside urgency/root-cause/action, so this
                    line is never a bare template). */}
                {activeAssessment.alert_summary && (
                  <p className="text-sm font-semibold text-gray-900 leading-relaxed mb-4">{activeAssessment.alert_summary}</p>
                )}

                {/* 4: operational urgency - the agent's prioritization call, most prominent element after the summary. */}
                {activeAssessment.urgency && (
                  <div className="mb-4">
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Urgency</div>
                    <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${URGENCY_STYLE[activeAssessment.urgency]}`}>
                      {activeAssessment.urgency}
                    </span>
                  </div>
                )}

                {/* 3: why the alert fired, using only the deterministic evidence. */}
                {activeAssessment.trigger_explanation && (
                  <div className="mb-4 pt-4 border-t border-blue-100">
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Why This Alert Fired</div>
                    <p className="text-sm text-gray-700 leading-relaxed">{activeAssessment.trigger_explanation}</p>
                  </div>
                )}

                <div className="mb-4 pt-4 border-t border-blue-100">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Current Deviation</div>
                  <p className="text-sm text-gray-700 leading-relaxed">{activeAssessment.current_observation}</p>
                </div>

                {/* 5: time remaining + what's at stake if unaddressed. */}
                <div className="mb-4 pt-4 border-t border-blue-100">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Predicted Deviation</div>
                  {activeAssessment.predicted_observation ? (
                    <>
                      <p className="text-sm text-gray-700 leading-relaxed">{activeAssessment.predicted_observation}</p>
                      {activeAssessment.time_to_breach_minutes != null && (
                        <p className="text-xs text-amber-700 font-semibold mt-1.5">
                          Estimated time to breach: ~{activeAssessment.time_to_breach_minutes} min
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-gray-400 italic">Forecast available once 30 min of history exist.</p>
                  )}
                  {activeAssessment.operational_impact && (
                    <p className="text-sm text-gray-600 leading-relaxed mt-2 italic">{activeAssessment.operational_impact}</p>
                  )}
                </div>

                {/* 6: concrete action, ahead of root cause - the operator should
                    know what to do before drilling into why, per the agent's
                    alert-first design. */}
                {activeAssessment.recommended_action && (
                  <div className="mb-4 pt-4 border-t border-blue-100">
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Recommended Action</div>
                    {/* whitespace-pre-line: the agent may return this as up to
                        3 short bullet lines separated by newlines - without
                        this, HTML would collapse them onto one run-on line. */}
                    <p className="text-sm text-gray-800 font-medium leading-relaxed whitespace-pre-line">{activeAssessment.recommended_action}</p>
                    {activeAssessment.recommendation_confidence_pct != null && (
                      <div className="mt-2 flex items-center gap-2 text-xs" title={activeAssessment.recommendation_confidence_explanation ?? undefined}>
                        <span className="font-bold text-gray-400 uppercase tracking-wider">Recommendation Confidence</span>
                        <span className={`font-bold ${CONFIDENCE_STYLE[activeAssessment.recommendation_confidence_level ?? 'Low']}`}>
                          {activeAssessment.recommendation_confidence_level} ({activeAssessment.recommendation_confidence_pct}%)
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* 7: root cause, synthesized from the ranked historical
                    fault-signature candidates - states plainly when nothing
                    fits well rather than forcing a diagnosis. */}
                {activeAssessment.likely_root_cause && (
                  <div className="mb-4 pt-4 border-t border-blue-100">
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Likely Root Cause</div>
                    <p className="text-sm text-gray-700 leading-relaxed">{activeAssessment.likely_root_cause}</p>
                    {activeAssessment.root_cause_confidence_pct != null && (
                      <div className="mt-2 flex items-center gap-2 text-xs" title={activeAssessment.root_cause_confidence_explanation ?? undefined}>
                        <span className="font-bold text-gray-400 uppercase tracking-wider">Root Cause Confidence</span>
                        <span className={`font-bold ${CONFIDENCE_STYLE[activeAssessment.root_cause_confidence_level ?? 'Low']}`}>
                          {activeAssessment.root_cause_confidence_level} ({activeAssessment.root_cause_confidence_pct}%)
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {activeAssessment.confidence && (
                  <div className="pt-4 border-t border-blue-100 flex items-center justify-between text-xs">
                    <span className="font-bold text-gray-400 uppercase tracking-wider">Confidence</span>
                    <span className={`font-bold ${CONFIDENCE_STYLE[activeAssessment.confidence]}`}>{activeAssessment.confidence}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-blue-50/50 rounded-lg shadow-sm border border-blue-100 p-6 h-fit">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
                  <Info className="text-blue-600" /> What This Means
                </h2>
                <div className={`p-4 rounded-xl border ${activeParamObj.status === 'normal' ? 'bg-white border-gray-200 text-gray-700' : activeParamObj.status === 'warning' ? 'bg-yellow-50 border-yellow-200 text-yellow-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                  <p className="text-sm leading-relaxed font-medium">
                    {(() => {
                      const diff = (activeParamObj.current - activeParamObj.golden).toFixed(2);
                      const sign = Number(diff) > 0 ? '+' : '';
                      if (activeParamObj.status === 'normal') {
                        return `${activeParamObj.label} is running close to the ideal profile (${sign}${diff} ${activeParamObj.unit} off) at this point in the batch.`;
                      } else if (activeParamObj.status === 'warning') {
                        return `${activeParamObj.label} is drifting from the ideal profile (${sign}${diff} ${activeParamObj.unit}) and is nearing the edge of the expected range.`;
                      }
                      return `${activeParamObj.label} has moved outside the expected range (${sign}${diff} ${activeParamObj.unit} from ideal).`;
                    })()}
                  </p>
                  <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-widest pt-4 border-t border-gray-100/30">
                    Expected range right now:
                    <span className="bg-white/50 px-2 py-0.5 rounded border border-gray-200/50">
                      {activeParamObj.lowerLimit} - {activeParamObj.upperLimit} {activeParamObj.unit}
                    </span>
                  </div>
                </div>
              </div>
            )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
