import {
  Award,
  ShieldCheck,
  Activity,
  FileText,
  Calendar,
  Clock,
  Flame,
  Check,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { KPIInfoModal } from '../components/KPIInfoModal';
import { getKPIDefinition } from '../lib/kpiDefinitions';
import { fetchBatchSummary, fetchTimeline, fetchParameterConfig, fetchBatchKPIs, GOLDEN_BATCH_ID } from '../lib/api';
import type { BatchSummary, TimelineResponse, ParameterConfigEntry, BatchKPIs } from '../lib/api';

// Not sourced from any API field yet - carried over from the original
// per-parameter design as a stable classification label, not invented data.
const IMPORTANCE_BY_PARAM: Record<string, string> = {
  temperature: 'Critical',
  process_pressure: 'Critical',
  flow_rate: 'Standard',
  agitator_rpm: 'Critical',
};

// Cosmetic checklist text - no real dataset source, left unchanged per scope.
const selectionReasons = [
  { title: 'Highest Yield', desc: 'Overall yield reached 99.2%, minimizing material waste and raw ingredient scrap to near-zero levels.' },
  { title: 'Highest Quality Score', desc: 'Critical quality attributes averaged a consistent 99.5% purity with zero Out-of-Specification (OOS) occurrences.' },
  { title: 'Lowest Cycle Time', desc: 'Granulation and final drying steps completed with optimal process throughput efficiency.' },
  { title: 'Lowest Energy Consumption', desc: 'Process energy requirement was 12% lower than average runs due to optimized temperature ramps.' },
  { title: 'Stable Process Parameters', desc: 'Critical variables (inlet temperature, feed pressures, speeds) stayed within ±1% of nominal targets.' },
  { title: 'Zero Critical Deviations', desc: 'No system alarms, critical anomalies, or safety violations were triggered during execution.' },
  { title: 'Passed All Quality Tests', desc: 'Full compliance across all target granule sizes, dissolution profiles, and assay stability specifications.' },
];

const kpiIdMap: Record<string, string> = {
  'Yield': 'yield',
  'Quality Score': 'qualityScore',
  'Cycle Time': 'cycleTime',
  'Energy Consumption': 'sec',
  'Process Stability': 'processStability',
  'OEE': 'oee',
};

export default function GoldenBatch() {
  const [activeKPIId, setActiveKPIId] = useState<string | null>(null);

  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [paramConfig, setParamConfig] = useState<ParameterConfigEntry[]>([]);
  const [kpis, setKpis] = useState<BatchKPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchBatchSummary(GOLDEN_BATCH_ID),
      fetchTimeline(GOLDEN_BATCH_ID),
      fetchParameterConfig(),
      fetchBatchKPIs(GOLDEN_BATCH_ID),
    ])
      .then(([summaryRes, timelineRes, configRes, kpisRes]) => {
        if (cancelled) return;
        setSummary(summaryRes);
        setTimeline(timelineRes);
        setParamConfig(configRes);
        setKpis(kpisRes);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto flex flex-col items-center justify-center h-96 gap-3 text-gray-500">
        <Loader2 className="animate-spin" size={28} />
        <p className="text-sm font-medium">Loading the golden batch record…</p>
      </div>
    );
  }

  if (error || !summary || !timeline || !kpis) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 flex items-start gap-3">
          <AlertTriangle className="text-red-500 mt-0.5 shrink-0" size={20} />
          <div>
            <h2 className="text-sm font-bold text-red-800">Could not load the golden batch</h2>
            <p className="text-xs text-red-700 mt-1 leading-relaxed">{error ?? 'Unknown error'}</p>
          </div>
        </div>
      </div>
    );
  }

  const durationHrs = `${(summary.batch_duration_minutes / 60).toFixed(2)} hrs`;
  const manufacturingDate = summary.batch_start_datetime.slice(0, 10);

  // Averaging across the whole batch (dispensing/mixing/cooling included, where
  // these parameters are legitimately near-zero) would dilute the value into
  // something meaningless - restrict to the same steady-state drying window
  // already used for valid predictions, where "optimal value" actually means something.
  const { min_elapsed_minutes: steadyStart, max_elapsed_minutes: steadyEnd } = summary.valid_time_range;
  const steadyStatePoints = timeline.points.filter(
    (p) => p.elapsed_minutes >= steadyStart && p.elapsed_minutes <= steadyEnd,
  );

  const optimalParams = paramConfig.map((cfg) => {
    const values = steadyStatePoints.map((p) => p[cfg.key as keyof typeof p] as number);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return {
      key: cfg.key,
      name: cfg.label,
      value: `${avg.toFixed(1)} ${cfg.unit}`,
      range: `${cfg.lower_limit} - ${cfg.upper_limit} ${cfg.unit}`,
      importance: IMPORTANCE_BY_PARAM[cfg.key] ?? 'Standard',
    };
  });

  // synthetic=true only for the two fields that are still batch-level-constant
  // draws with no grounding in this batch's own real data (see
  // docs/batch-kpis-prediction-readiness-review.md). Energy/Process
  // Stability/OEE are real, derived, or a formula over real+derived inputs,
  // so they no longer carry the caveat.
  const performanceKPIs = [
    { label: 'Yield', value: `${kpis.yield_pct.toFixed(1)}%`, icon: <Activity className="h-5 w-5 text-emerald-600" />, color: 'bg-emerald-50', synthetic: true },
    { label: 'Quality Score', value: `${kpis.quality_score_pct.toFixed(1)}%`, icon: <ShieldCheck className="h-5 w-5 text-rose-600" />, color: 'bg-rose-50', synthetic: true },
    { label: 'Cycle Time', value: durationHrs, icon: <Clock className="h-5 w-5 text-blue-600" />, color: 'bg-blue-50', synthetic: false },
    { label: 'Energy Consumption', value: `${kpis.total_energy_kwh.toFixed(0)} kWh`, icon: <Flame className="h-5 w-5 text-orange-600" />, color: 'bg-orange-50', synthetic: false },
    { label: 'Process Stability', value: `${kpis.process_stability_pct.toFixed(1)}%`, icon: <Award className="h-5 w-5 text-teal-600" />, color: 'bg-teal-50', synthetic: false },
    { label: 'OEE', value: `${kpis.oee_pct.toFixed(1)}%`, icon: <Activity className="h-5 w-5 text-indigo-600" />, color: 'bg-indigo-50', synthetic: false },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex justify-between items-end border-b border-gray-200 pb-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Award className="h-6 w-6 text-teal-600" /> Golden Batch Reference Profile
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Real recorded benchmark for Paracetamol 500mg — the only product with a generated golden batch today
          </p>
        </div>
        <div className="flex gap-4 items-center">
          <div className="text-right">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Active Golden Batch</div>
            <div className="text-sm font-bold text-slate-800 font-mono">{summary.batch_id}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (7 cols) */}
        <div className="lg:col-span-7 space-y-6">

          {/* Section: Golden Batch Reference Summary */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 transition-shadow hover:shadow-md">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 text-lg">Golden Batch Reference Summary</h3>
                <p className="text-xs text-gray-500">Real record metadata from the generated dataset</p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-2">
              <div>
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Golden Batch ID</span>
                <span className="text-sm font-bold text-slate-800 font-mono mt-0.5 block">{summary.batch_id}</span>
              </div>
              <div>
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Plant Facility</span>
                <span className="text-sm font-semibold text-slate-700 mt-0.5 block">{summary.plant}</span>
              </div>
              <div>
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Product</span>
                <span className="text-sm font-semibold text-slate-700 mt-0.5 block">{summary.product}</span>
              </div>
              <div>
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Manufacturing Date</span>
                <span className="text-sm font-semibold text-slate-700 mt-0.5 block flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-gray-400" /> {manufacturingDate}
                </span>
              </div>
              <div>
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Batch Duration</span>
                <span className="text-sm font-semibold text-slate-700 mt-0.5 block flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-gray-400" /> {durationHrs}
                </span>
              </div>
              <div>
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Overall Performance Score (OEE)
                </span>
                <span className="text-sm font-bold text-teal-600 mt-0.5 block">{kpis.oee_pct.toFixed(1)}%</span>
              </div>
            </div>
          </div>

          {/* Section: Optimal Process Parameters */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 transition-shadow hover:shadow-md">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 text-lg">Optimal Process Parameters</h3>
                <p className="text-xs text-gray-500">Average recorded value and real operating range from the golden batch's own timeline</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    <th className="py-2.5">Parameter Name</th>
                    <th className="py-2.5 text-right">Optimal Value</th>
                    <th className="py-2.5 text-right">Operating Range</th>
                    <th className="py-2.5 text-right">Classification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 text-gray-700">
                  {optimalParams.map((param) => (
                    <tr key={param.key} className="hover:bg-slate-50/50">
                      <td className="py-3 font-medium text-slate-800">{param.name}</td>
                      <td className="py-3 text-right font-bold text-slate-900">{param.value}</td>
                      <td className="py-3 text-right text-gray-500 font-mono text-xs">{param.range}</td>
                      <td className="py-3 text-right">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                          param.importance === 'Critical'
                            ? 'bg-rose-50 text-rose-700 border border-rose-100'
                            : param.importance === 'Important'
                            ? 'bg-amber-50 text-amber-700 border border-amber-100'
                            : 'bg-slate-50 text-slate-600 border border-slate-100'
                        }`}>
                          {param.importance}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-gray-400 mt-3">
              Classification labels are a static reference tag, not yet sourced from an API field.
            </p>
          </div>

        </div>

        {/* Right Column (5 cols) */}
        <div className="lg:col-span-5 space-y-6">

          {/* Section: Golden Batch Performance KPIs */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 transition-shadow hover:shadow-md">
            <h3 className="font-semibold text-gray-900 text-lg mb-4 flex items-center gap-2">
              <Activity className="h-5 w-5 text-indigo-500" /> Golden Batch Performance KPIs
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {performanceKPIs.map((kpi, idx) => {
                const kpiId = kpiIdMap[kpi.label];
                return (
                  <button
                    key={idx}
                    onClick={() => setActiveKPIId(kpiId)}
                    className="text-left bg-slate-50/50 rounded-xl p-4 border border-slate-100 flex flex-col justify-between hover:bg-white hover:shadow-sm transition-all cursor-pointer hover:ring-2 hover:ring-indigo-100"
                  >
                    <span className="text-xs font-semibold text-gray-500 tracking-wide uppercase flex items-center gap-1.5">
                      {kpi.label}
                      {kpi.synthetic && (
                        <span className="text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 py-px normal-case">synthetic</span>
                      )}
                    </span>
                    <div className="flex items-center justify-between mt-3">
                      <div className={`p-2 rounded-lg ${kpi.color}`}>
                        {kpi.icon}
                      </div>
                      <span className="text-lg font-bold text-gray-900">{kpi.value}</span>
                    </div>
                    <span className="text-[10px] font-semibold text-indigo-400 mt-2">Click for details</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section: Why This Batch Was Selected */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 transition-shadow hover:shadow-md">
            <h3 className="font-semibold text-gray-900 text-lg mb-4 flex items-center">
              <ShieldCheck className="h-5 w-5 mr-2 text-emerald-600" />
              Why This Batch Was Selected
            </h3>
            <div className="space-y-4">
              {selectionReasons.map((item, index) => (
                <div key={index} className="flex items-start gap-3">
                  <div className="p-1 bg-emerald-50 rounded-full text-emerald-600 mt-0.5 flex-shrink-0">
                    <Check className="h-3.5 w-3.5 stroke-[3]" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-gray-800">{item.title}</h4>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* KPI Education Modal */}
      {activeKPIId && getKPIDefinition(activeKPIId) && (
        <KPIInfoModal
          kpiDefinition={getKPIDefinition(activeKPIId)!}
          currentValue={performanceKPIs.find((k) => kpiIdMap[k.label] === activeKPIId)?.value}
          onClose={() => setActiveKPIId(null)}
        />
      )}

    </div>
  );
}
