import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, ReferenceArea, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { BrainCircuit, Info, Loader2, AlertTriangle, History } from 'lucide-react';
import {
  fetchBatches, fetchTimeline, fetchParameterConfig, GOLDEN_BATCH_ID,
} from '../lib/api';
import type { BatchSummary, TimelineResponse, ParameterConfigEntry } from '../lib/api';

const WARNING_MARGIN_FRACTION = 0.15;

interface ParamCard {
  key: string;
  label: string;
  unit: string;
  current: number;
  golden: number;
  lowerLimit: number;
  upperLimit: number;
  status: 'normal' | 'warning' | 'critical';
}

const classifyStatus = (value: number, lo: number, hi: number): 'normal' | 'warning' | 'critical' => {
  if (value < lo || value > hi) return 'critical';
  const margin = (hi - lo) * WARNING_MARGIN_FRACTION;
  if (value < lo + margin || value > hi - margin) return 'warning';
  return 'normal';
};

export default function ProcessMonitoring() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  const [paramConfig, setParamConfig] = useState<ParameterConfigEntry[]>([]);
  const [goldenTimeline, setGoldenTimeline] = useState<TimelineResponse | null>(null);

  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);

  const [activeParamKey, setActiveParamKey] = useState('temperature');

  const selectedBatch = batches.find((b) => b.batch_id === selectedBatchId) ?? null;

  // Reference data that doesn't depend on which batch is selected - fetched once.
  useEffect(() => {
    fetchParameterConfig().then(setParamConfig).catch(() => setParamConfig([]));
    fetchTimeline(GOLDEN_BATCH_ID).then(setGoldenTimeline).catch(() => setGoldenTimeline(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setBatchesLoading(true);
    setBatchesError(null);
    fetchBatches()
      .then((data) => {
        if (cancelled) return;
        setBatches(data);
        if (data.length > 0) setSelectedBatchId(data[0].batch_id);
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
    if (!selectedBatchId) return;
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
  }, [selectedBatchId]);

  const goldenPointAt = (elapsedMinutes: number) => {
    if (!goldenTimeline || goldenTimeline.points.length === 0) return undefined;
    const exact = goldenTimeline.points.find((p) => p.elapsed_minutes === elapsedMinutes);
    if (exact) return exact;
    const maxGolden = goldenTimeline.points[goldenTimeline.points.length - 1];
    return elapsedMinutes > maxGolden.elapsed_minutes ? maxGolden : goldenTimeline.points[0];
  };

  const paramCards: ParamCard[] = useMemo(() => {
    if (!timeline || timeline.points.length === 0 || paramConfig.length === 0) return [];
    const latest = timeline.points[timeline.points.length - 1];
    const goldenAtLatest = goldenPointAt(latest.elapsed_minutes);

    return paramConfig.map((cfg) => {
      const current = latest[cfg.key as keyof typeof latest] as number;
      const golden = goldenAtLatest ? (goldenAtLatest[cfg.key as keyof typeof goldenAtLatest] as number) : current;
      return {
        key: cfg.key,
        label: cfg.label,
        unit: cfg.unit,
        current,
        golden,
        lowerLimit: cfg.lower_limit,
        upperLimit: cfg.upper_limit,
        status: classifyStatus(current, cfg.lower_limit, cfg.upper_limit),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, paramConfig, goldenTimeline]);

  useEffect(() => {
    if (paramCards.length > 0 && !paramCards.find((p) => p.key === activeParamKey)) {
      setActiveParamKey(paramCards[0].key);
    }
  }, [paramCards, activeParamKey]);

  const activeParamObj = paramCards.find((p) => p.key === activeParamKey) ?? paramCards[0];

  const chartData = useMemo(() => {
    if (!timeline) return [];
    return timeline.points.map((p) => {
      const golden = goldenPointAt(p.elapsed_minutes);
      const point: Record<string, number> = {
        elapsed_minutes: p.elapsed_minutes,
        [activeParamKey]: p[activeParamKey as keyof typeof p] as number,
      };
      if (golden) point[`golden_${activeParamKey}`] = golden[activeParamKey as keyof typeof golden] as number;
      return point;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, activeParamKey, goldenTimeline]);

  const stats = useMemo(() => {
    if (!timeline || timeline.points.length === 0) return { avg: 0, min: 0, max: 0, variance: 0, stdDev: 0 };
    const values = timeline.points.map((p) => p[activeParamKey as keyof typeof p] as number);
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
  }, [timeline, activeParamKey]);

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

  if (batchesLoading) {
    return (
      <div className="max-w-7xl mx-auto flex flex-col items-center justify-center h-96 gap-3 text-gray-500">
        <Loader2 className="animate-spin" size={28} />
        <p className="text-sm font-medium">Loading batches from the process API…</p>
      </div>
    );
  }

  if (batchesError) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 flex items-start gap-3">
          <AlertTriangle className="text-red-500 mt-0.5 shrink-0" size={20} />
          <div>
            <h2 className="text-sm font-bold text-red-800">Could not load batches</h2>
            <p className="text-xs text-red-700 mt-1 leading-relaxed">{batchesError}</p>
          </div>
        </div>
      </div>
    );
  }

  if (batches.length === 0) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center text-sm text-gray-500">
          No batches available.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Process Monitoring</h1>
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
        </div>
      </div>

      {timelineError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="text-red-500 mt-0.5 shrink-0" size={18} />
          <p className="text-xs text-red-700 leading-relaxed">{timelineError}</p>
        </div>
      )}

      <div className={timelineLoading ? 'opacity-50 pointer-events-none transition-opacity' : 'transition-opacity'}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {paramCards.map((param) => {
            const dev = param.current - param.golden;
            return (
              <div key={param.key} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 relative overflow-hidden">
                <div className="flex justify-between items-start mb-4">
                  <span className="text-sm font-medium text-gray-500">{param.label}</span>
                  <span className={`w-3 h-3 rounded-full ${param.status === 'normal' ? 'bg-green-500' : param.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'}`}></span>
                </div>
                <div className="text-2xl font-bold text-gray-900 mb-1">{param.current} {param.unit}</div>
                <div className="text-sm text-gray-500 flex justify-between">
                  <span>Golden: {param.golden}</span>
                  <span className={`font-medium ${dev > 0 ? 'text-rose-600' : dev < 0 ? 'text-indigo-600' : 'text-gray-600'}`}>
                    Dev: {dev > 0 ? '+' : ''}{dev.toFixed(2)}
                  </span>
                </div>
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
                  <Info size={16} className="text-blue-500" /> {activeParamObj.label} Statistics (Full Batch Record)
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
                  Target Operating Band:
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
