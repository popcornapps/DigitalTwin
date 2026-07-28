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
  Info,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { KPIInfoModal } from '../components/KPIInfoModal';
import { getKPIDefinition, buildCurrentCalculation } from '../lib/kpiDefinitions';
import { fetchBatchSummary, fetchTimeline, fetchParameterConfig, fetchBatchKPIs, fetchAllBatchKPIs, GOLDEN_BATCH_ID } from '../lib/api';
import type { BatchSummary, TimelineResponse, ParameterConfigEntry, BatchKPIs } from '../lib/api';

// Predefined engineering metadata - how important each parameter is to the
// drying phase and product quality. Not derived from telemetry or statistics.
const CRITICALITY_BY_PARAM: Record<string, string> = {
  temperature: 'Critical',
  process_pressure: 'Critical',
  flow_rate: 'High',
  agitator_rpm: 'Medium',
};

const PROCESS_CRITICALITY_TOOLTIP =
  'Engineering assessment of how important each parameter is to maintaining process performance and product quality during the drying phase. This is predefined process metadata and is not calculated from the selected Golden Batch.';

// Every reason below is computed from this batch's real KPIs (and, where a
// comparison is meaningful, its real percentile rank against every other
// batch) - not asserted text. A reason is only included when its underlying
// number actually clears a defensible bar, so "why this is the golden batch"
// never claims more than the data supports. Deliberately no "Highest
// Yield"/"Lowest Energy" style #1 claims - the KPI formulas are identical for
// every batch, so those claims would frequently be false (verified against
// the real dataset: this batch currently ranks outside the top 25 on both
// Yield and Energy). The honest, still-compelling story is "excellent and
// well-controlled," not "wins every category."
function buildGoldenBatchReasons(
  kpis: BatchKPIs,
  summary: BatchSummary,
  allKpis: BatchKPIs[],
): { title: string; desc: string }[] {
  const reasons: { title: string; desc: string }[] = [];

  // % of OTHER batches this batch's value beats (lowerIsBetter flips the
  // comparison direction for metrics like energy). null if no population data
  // was available yet (e.g. the all-batches fetch failed) - callers fall back
  // to plain, non-comparative wording in that case.
  const others = allKpis.filter((b) => b.batch_id !== kpis.batch_id);
  const percentile = (key: keyof BatchKPIs, lowerIsBetter = false): number | null => {
    if (others.length === 0) return null;
    const value = kpis[key] as number;
    const beaten = others.filter((b) => {
      const v = b[key] as number;
      return lowerIsBetter ? v > value : v < value;
    }).length;
    return Math.round((beaten / others.length) * 100);
  };

  // Zero Critical Deviations - real ground-truth label + real fault-onset check, not an assertion.
  if (summary.ground_truth_severity === 'Normal' && kpis.fault_onset_elapsed_minutes === null) {
    reasons.push({
      title: 'Zero Critical Deviations',
      desc: 'No process parameter left its control band at any point during the batch, per its own recorded telemetry.',
    });
  }

  // Yield - benchmark per kpiDefinitions.ts: 96-99.5%, 99%+ for high-value products.
  if (kpis.yield_pct >= 97) {
    const pct = percentile('yield_pct');
    reasons.push({
      title: 'Excellent Yield',
      desc: `${kpis.actual_output_kg.toFixed(1)} kg from a ${kpis.theoretical_output_kg.toFixed(0)} kg theoretical output (${kpis.yield_pct.toFixed(1)}%)`
        + (pct !== null ? `, better than ${pct}% of all batches.` : '.'),
    });
  }

  // Quality (Assay) - real spec check: 95-105% of label claim, target 100%.
  if (kpis.assay_pct >= 95 && kpis.assay_pct <= 105) {
    const pct = percentile('quality_score_pct');
    reasons.push({
      title: 'Excellent Quality (Assay In Spec)',
      desc: `Assay measured ${kpis.assay_pct.toFixed(1)}% of label claim, within the 95-105% specification (target 100%)`
        + (pct !== null ? ` - Quality Score better than ${pct}% of all batches.` : '.'),
    });
  }

  // OEE - benchmark per kpiDefinitions.ts: 85%+ world-class.
  if (kpis.oee_pct >= 85) {
    const pct = percentile('oee_pct');
    reasons.push({
      title: 'Strong Overall OEE',
      desc: `${kpis.oee_pct.toFixed(1)}% OEE (Availability ${kpis.oee_availability_pct.toFixed(1)}% × Performance ${kpis.oee_performance_pct.toFixed(1)}% × Quality ${kpis.oee_quality_pct.toFixed(1)}%)`
        + (pct !== null ? `, better than ${pct}% of all batches.` : '.'),
    });
  }

  // Energy - lower is better; only claimed when this batch genuinely beats
  // at least half the population, and phrased as a percentile, never "Lowest".
  const energyPct = percentile('total_energy_kwh', true);
  if (energyPct !== null && energyPct >= 50) {
    reasons.push({
      title: 'Efficient Energy Usage',
      desc: `${kpis.total_energy_kwh.toFixed(0)} kWh total (${kpis.sec_kwh_per_kg.toFixed(2)} kWh/kg) - more efficient than ${energyPct}% of all batches.`,
    });
  }

  return reasons;
}

const kpiIdMap: Record<string, string> = {
  'Yield': 'yield',
  'Quality Score': 'qualityScore',
  'Cycle Time': 'cycleTime',
  'Specific Energy Consumption': 'sec',
  'OEE': 'oee',
};

export default function GoldenBatch() {
  const [activeKPIId, setActiveKPIId] = useState<string | null>(null);

  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [paramConfig, setParamConfig] = useState<ParameterConfigEntry[]>([]);
  const [kpis, setKpis] = useState<BatchKPIs | null>(null);
  const [allKpis, setAllKpis] = useState<BatchKPIs[]>([]);
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
    // Fetched independently of the core page data - only used to turn "Why
    // This Batch Was Selected" into percentile comparisons. A hiccup here
    // shouldn't block the rest of the page; the reasons below just fall back
    // to non-comparative wording if this never arrives.
    fetchAllBatchKPIs()
      .then((data) => {
        if (!cancelled) setAllKpis(data);
      })
      .catch(() => {
        if (!cancelled) setAllKpis([]);
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
  const goldenBatchReasons = buildGoldenBatchReasons(kpis, summary, allKpis);

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
    // Real min/max actually observed in THIS batch's own steady-state window -
    // replaces the old fixed parameter_config.csv band, which was a shared
    // static reference applied identically to every batch, not derived from
    // the golden batch's own data at all.
    const min = Math.min(...values);
    const max = Math.max(...values);
    return {
      key: cfg.key,
      name: cfg.label,
      value: `${avg.toFixed(1)} ${cfg.unit}`,
      range: `${min.toFixed(1)} - ${max.toFixed(1)} ${cfg.unit}`,
      criticality: CRITICALITY_BY_PARAM[cfg.key] ?? 'Medium',
    };
  });

  // All six are now real/derived from this batch's own data (actual_output_kg,
  // assay_pct, process_stability_pct, etc.) - none are independent random
  // draws anymore, so none carry a "synthetic" caveat. `detail` surfaces the
  // real inputs behind the headline ratio where that's useful context.
  const performanceKPIs = [
    {
      label: 'Yield', value: `${kpis.yield_pct.toFixed(1)}%`,
      detail: `${kpis.actual_output_kg.toFixed(1)} / ${kpis.theoretical_output_kg.toFixed(0)} kg`,
      icon: <Activity className="h-5 w-5 text-emerald-600" />, color: 'bg-emerald-50',
    },
    {
      label: 'Quality Score', value: `${kpis.quality_score_pct.toFixed(1)}%`,
      detail: `Assay: ${kpis.assay_pct.toFixed(1)}%`,
      icon: <ShieldCheck className="h-5 w-5 text-rose-600" />, color: 'bg-rose-50',
    },
    { label: 'Cycle Time', value: durationHrs, icon: <Clock className="h-5 w-5 text-blue-600" />, color: 'bg-blue-50' },
    {
      label: 'Specific Energy Consumption', value: `${kpis.sec_kwh_per_kg.toFixed(2)} kWh/kg`,
      icon: <Flame className="h-5 w-5 text-orange-600" />, color: 'bg-orange-50',
    },
    { label: 'OEE', value: `${kpis.oee_pct.toFixed(1)}%`, icon: <Activity className="h-5 w-5 text-indigo-600" />, color: 'bg-indigo-50' },
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
                <p className="text-xs text-gray-500">Average recorded value and real observed range from the golden batch's own timeline</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    <th className="py-2.5">Parameter Name</th>
                    <th className="py-2.5 text-right">Optimal Value</th>
                    <th className="py-2.5 text-right">Observed Range</th>
                    <th className="py-2.5 text-right">
                      <span
                        className="inline-flex items-center gap-1 justify-end cursor-help"
                        title={PROCESS_CRITICALITY_TOOLTIP}
                      >
                        Process Criticality
                        <Info className="h-3 w-3 text-gray-400" />
                      </span>
                    </th>
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
                          param.criticality === 'Critical'
                            ? 'bg-rose-50 text-rose-700 border border-rose-100'
                            : param.criticality === 'High'
                            ? 'bg-amber-50 text-amber-700 border border-amber-100'
                            : 'bg-slate-50 text-slate-600 border border-slate-100'
                        }`}>
                          {param.criticality}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-gray-400 mt-3">
              Process Criticality is predefined engineering metadata, not calculated from this batch's data.
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
                    <span className="text-xs font-semibold text-gray-500 tracking-wide uppercase">
                      {kpi.label}
                    </span>
                    <div className="flex items-center justify-between mt-3">
                      <div className={`p-2 rounded-lg ${kpi.color}`}>
                        {kpi.icon}
                      </div>
                      <span className="text-lg font-bold text-gray-900">{kpi.value}</span>
                    </div>
                    {'detail' in kpi && (
                      <span className="text-[10px] font-medium text-gray-400 mt-1">{kpi.detail}</span>
                    )}
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
            {goldenBatchReasons.length > 0 ? (
              <div className="space-y-4">
                {goldenBatchReasons.map((item, index) => (
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
            ) : (
              <p className="text-xs text-gray-500">
                This batch's real KPIs don't yet clear the bar on any tracked strength.
              </p>
            )}
            <p className="text-[10px] text-gray-400 mt-4">
              This batch is the manufacturing reference because it's excellent and well-controlled overall - not
              necessarily the single best performer on every individual KPI.
            </p>
          </div>

        </div>
      </div>

      {/* KPI Education Modal */}
      {activeKPIId && getKPIDefinition(activeKPIId) && (
        <KPIInfoModal
          kpiDefinition={getKPIDefinition(activeKPIId)!}
          currentValue={performanceKPIs.find((k) => kpiIdMap[k.label] === activeKPIId)?.value}
          currentCalculation={buildCurrentCalculation(activeKPIId, kpis)}
          onClose={() => setActiveKPIId(null)}
        />
      )}

    </div>
  );
}
