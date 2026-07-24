import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Activity, ShieldCheck, Clock, Flame, Award, XCircle, Loader2, AlertTriangle, Radio, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { KPIInfoModal } from '../components/KPIInfoModal';
import { getKPIDefinition } from '../lib/kpiDefinitions';
import { fetchBatches, fetchAllBatchKPIs, fetchRunningBatches } from '../lib/api';
import type { BatchSummary, BatchKPIs, RunningBatchSummary } from '../lib/api';
import { PERSONA_CONFIGS } from '../App';
import { useFilter } from '../context/FilterContext';

const SEVERITY_STYLES: Record<string, string> = {
  Normal: 'bg-emerald-100 text-emerald-800',
  Warning: 'bg-amber-100 text-amber-800',
  Critical: 'bg-red-100 text-red-800',
};

const LIVE_STATUS_STYLES: Record<string, string> = {
  Running: 'bg-blue-100 text-blue-800',
  Completed: 'bg-green-100 text-green-800',
  Stopped: 'bg-gray-100 text-gray-700',
};

// A single row can be either a finished historical batch or a live running
// batch - the two have meaningfully different shapes (a running batch has no
// yield/quality/outcome yet, since it hasn't finished), so rows are a
// discriminated union rather than forcing both into one flat type.
type ExplorerRow =
  | { kind: 'historical'; batch: BatchSummary }
  | { kind: 'live'; batch: RunningBatchSummary };

const rowId = (row: ExplorerRow) => (row.kind === 'historical' ? row.batch.batch_id : row.batch.running_batch_id);
const rowStatus = (row: ExplorerRow) => (row.kind === 'historical' ? 'Completed' : row.batch.status);

function KpiCard({ label, value, icon, color, onClick, hint }: { label: string; value: string; icon: ReactNode; color: string; onClick?: () => void; hint?: string }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`text-left bg-slate-50/50 rounded-xl p-4 border border-slate-100 flex flex-col justify-between hover:bg-white hover:shadow-sm transition-all ${onClick ? 'cursor-pointer hover:ring-2 hover:ring-indigo-100' : ''}`}
    >
      <span className="text-xs font-semibold text-gray-500 tracking-wide uppercase">{label}</span>
      <div className="flex items-center justify-between mt-3">
        <div className={`p-2 rounded-lg ${color}`}>{icon}</div>
        <span className="text-lg font-bold text-gray-900">{value}</span>
      </div>
      {hint && <span className="text-[10px] font-semibold text-indigo-400 mt-2">{hint}</span>}
    </Tag>
  );
}

const formatDateTime = (iso: string) => new Date(iso).toLocaleString(undefined, {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

export default function BatchExplorer() {
  const navigate = useNavigate();
  const { selectedPersona } = useFilter();
  const canViewProcessMonitoring = PERSONA_CONFIGS[selectedPersona]?.visiblePages.includes('/process-monitoring') ?? false;
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [kpis, setKpis] = useState<BatchKPIs[]>([]);
  const [runningBatches, setRunningBatches] = useState<RunningBatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sortField, setSortField] = useState<'yield' | 'quality' | 'none'>('none');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [activeKPIId, setActiveKPIId] = useState<string | null>(null);
  const [activeRunningBatchId, setActiveRunningBatchId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchBatches('all'), fetchAllBatchKPIs()])
      .then(([batchesRes, kpisRes]) => {
        if (cancelled) return;
        setBatches(batchesRes);
        setKpis(kpisRes);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Fetched and failed independently of the historical batches - the live
    // subsystem is supplemental here, so a hiccup in it shouldn't block
    // browsing the 120 historical batches.
    fetchRunningBatches()
      .then((data) => {
        if (!cancelled) setRunningBatches(data);
      })
      .catch(() => {
        if (!cancelled) setRunningBatches([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const kpiMap = useMemo(() => new Map(kpis.map((k) => [k.batch_id, k])), [kpis]);

  const activeBatch = batches.find((b) => b.batch_id === activeBatchId) ?? null;
  const activeKpis = activeBatch ? kpiMap.get(activeBatch.batch_id) ?? null : null;
  const cycleTimeHrs = activeBatch ? (activeBatch.batch_duration_minutes / 60).toFixed(2) : null;
  const activeRunningBatch = runningBatches.find((b) => b.running_batch_id === activeRunningBatchId) ?? null;

  const closeBatchModal = () => {
    setActiveBatchId(null);
    setActiveKPIId(null);
  };

  const allRows: ExplorerRow[] = useMemo(() => [
    ...runningBatches.map((batch): ExplorerRow => ({ kind: 'live', batch })),
    ...batches.map((batch): ExplorerRow => ({ kind: 'historical', batch })),
  ], [batches, runningBatches]);

  const filteredAndSortedRows = useMemo(() => {
    let result = [...allRows];

    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter((row) => rowId(row).toLowerCase().includes(s) || row.batch.product.toLowerCase().includes(s));
    }

    if (statusFilter !== 'All') {
      result = result.filter((row) => rowStatus(row) === statusFilter);
    }

    if (sortField !== 'none') {
      const key = sortField === 'yield' ? 'yield_pct' : 'quality_score_pct';
      result = [...result].sort((a, b) => {
        // kpiMap only has entries for finished historical batches, so a live
        // batch's yield/quality is naturally undefined here (it hasn't
        // produced a real yield yet) and sorts to the end, same as before.
        const av = kpiMap.get(rowId(a))?.[key];
        const bv = kpiMap.get(rowId(b))?.[key];
        if (av === undefined && bv === undefined) return 0;
        if (av === undefined) return 1;
        if (bv === undefined) return -1;
        return sortDir === 'asc' ? av - bv : bv - av;
      });
    }

    return result;
  }, [allRows, search, statusFilter, sortField, sortDir, kpiMap]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto flex flex-col items-center justify-center h-96 gap-3 text-gray-500">
        <Loader2 className="animate-spin" size={28} />
        <p className="text-sm font-medium">Loading batches from the API…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 flex items-start gap-3">
          <AlertTriangle className="text-red-500 mt-0.5 shrink-0" size={20} />
          <div>
            <h2 className="text-sm font-bold text-red-800">Could not load batches</h2>
            <p className="text-xs text-red-700 mt-1 leading-relaxed">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Batch Explorer</h1>
          <p className="text-sm text-gray-500">
            Browsing all {allRows.length} Paracetamol 500mg batches ({batches.length} historical, {runningBatches.length} live)
          </p>
        </div>
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center bg-white border border-gray-200 rounded-md px-3 py-2">
            <Search size={16} className="text-gray-400 mr-2" />
            <input
              type="text"
              placeholder="Search batches..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="text-sm outline-none w-48"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 uppercase">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-gray-200 text-sm text-gray-700 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="All">All</option>
              <option value="Running">Running</option>
              <option value="Completed">Completed</option>
              <option value="Stopped">Stopped</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 uppercase">Yield:</span>
            <select
              value={sortField === 'yield' ? sortDir : 'none'}
              onChange={(e) => {
                if (e.target.value === 'none') { setSortField('none'); return; }
                setSortField('yield');
                setSortDir(e.target.value as 'asc' | 'desc');
              }}
              className="bg-white border border-gray-200 text-sm text-gray-700 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="none">-</option>
              <option value="desc">Highest first</option>
              <option value="asc">Lowest first</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 uppercase">Quality:</span>
            <select
              value={sortField === 'quality' ? sortDir : 'none'}
              onChange={(e) => {
                if (e.target.value === 'none') { setSortField('none'); return; }
                setSortField('quality');
                setSortDir(e.target.value as 'asc' | 'desc');
              }}
              className="bg-white border border-gray-200 text-sm text-gray-700 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="none">-</option>
              <option value="desc">Highest first</option>
              <option value="asc">Lowest first</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-left text-sm text-gray-600">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-700 uppercase">
            <tr>
              <th className="px-6 py-4 font-semibold">Batch ID</th>
              <th className="px-6 py-4 font-semibold">Product</th>
              <th className="px-6 py-4 font-semibold">Start Time</th>
              <th className="px-6 py-4 font-semibold">End Time</th>
              <th className="px-6 py-4 font-semibold">Status</th>
              <th className="px-6 py-4 font-semibold">Outcome</th>
              <th className="px-6 py-4 font-semibold">Yield</th>
              <th className="px-6 py-4 font-semibold">Quality</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredAndSortedRows.map((row) => {
              if (row.kind === 'historical') {
                const batch = row.batch;
                const start = new Date(batch.batch_start_datetime);
                const end = new Date(start.getTime() + batch.batch_duration_minutes * 60_000);
                const batchKpis = kpiMap.get(batch.batch_id);
                return (
                  <tr
                    key={`historical-${batch.batch_id}`}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => setActiveBatchId(batch.batch_id)}
                  >
                    <td className="px-6 py-4 font-medium text-blue-600 cursor-pointer">{batch.batch_id}</td>
                    <td className="px-6 py-4">{batch.product}</td>
                    <td className="px-6 py-4">{formatDateTime(start.toISOString())}</td>
                    <td className="px-6 py-4">{formatDateTime(end.toISOString())}</td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">Completed</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${SEVERITY_STYLES[batch.ground_truth_severity] ?? 'bg-gray-100 text-gray-700'}`}>
                        {batch.ground_truth_severity}
                      </span>
                      {batch.ground_truth_scenario !== 'None' && (
                        <span className="ml-2 text-xs text-gray-400">{batch.ground_truth_scenario.replace(/_/g, ' ')}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 font-medium text-gray-800">{batchKpis ? `${batchKpis.yield_pct.toFixed(1)}%` : '—'}</td>
                    <td className="px-6 py-4 font-medium text-gray-800">{batchKpis ? `${batchKpis.quality_score_pct.toFixed(1)}%` : '—'}</td>
                  </tr>
                );
              }

              const batch = row.batch;
              const started = new Date(batch.started_at);
              const approxEnd = new Date(started.getTime() + batch.elapsed_minutes * 60_000);
              return (
                <tr
                  key={`live-${batch.running_batch_id}`}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => setActiveRunningBatchId(batch.running_batch_id)}
                >
                  <td className="px-6 py-4 font-medium text-blue-600 cursor-pointer">
                    <span className="inline-flex items-center gap-1.5">
                      <Radio size={12} className={batch.status === 'Running' ? 'text-blue-500 animate-pulse' : 'text-gray-400'} />
                      {batch.running_batch_id}
                    </span>
                  </td>
                  <td className="px-6 py-4">{batch.product}</td>
                  <td className="px-6 py-4">{formatDateTime(started.toISOString())}</td>
                  <td className="px-6 py-4">{batch.status === 'Running' ? 'In progress' : formatDateTime(approxEnd.toISOString())}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${LIVE_STATUS_STYLES[batch.status] ?? 'bg-gray-100 text-gray-700'}`}>
                      {batch.status}
                    </span>
                  </td>
                  {/* No outcome to show yet - the batch hasn't finished, and
                      scenario_profile/drifting_parameter are simulation
                      inputs (what fault was scripted in), not a real result.
                      Showing them here would spoil what the agent is meant
                      to discover from telemetry, not from a label. */}
                  <td className="px-6 py-4 text-gray-400">—</td>
                  <td className="px-6 py-4 font-medium text-gray-800">—</td>
                  <td className="px-6 py-4 font-medium text-gray-800">—</td>
                </tr>
              );
            })}
            {filteredAndSortedRows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                  No batches found matching the selected criteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {activeBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 pointer-events-none bg-white/70 backdrop-blur-[2px]">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)] relative w-full max-w-2xl flex flex-col max-h-full overflow-hidden pointer-events-auto animate-fade-in-content ring-1 ring-black/5">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
              <div>
                <h2 className="text-sm font-bold text-gray-800 uppercase tracking-widest flex items-center gap-2">
                  <Activity size={16} className="text-indigo-500" /> Batch KPIs
                </h2>
                <p className="text-xs text-gray-500 font-mono mt-0.5">{activeBatch.batch_id}</p>
              </div>
              <button onClick={closeBatchModal} className="p-1 hover:bg-gray-200 rounded-md text-gray-500 transition-colors">
                <XCircle size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-4">
                <KpiCard
                  label="Yield"
                  value={activeKpis ? `${activeKpis.yield_pct.toFixed(1)}%` : '—'}
                  icon={<Activity className="h-5 w-5 text-emerald-600" />}
                  color="bg-emerald-50"
                  onClick={() => setActiveKPIId('yield')}
                  hint="Click for details"
                />
                <KpiCard
                  label="Quality Score"
                  value={activeKpis ? `${activeKpis.quality_score_pct.toFixed(1)}%` : '—'}
                  icon={<ShieldCheck className="h-5 w-5 text-rose-600" />}
                  color="bg-rose-50"
                  onClick={() => setActiveKPIId('qualityScore')}
                  hint="Click for details"
                />
                <KpiCard
                  label="Cycle Time"
                  value={`${cycleTimeHrs} hrs`}
                  icon={<Clock className="h-5 w-5 text-blue-600" />}
                  color="bg-blue-50"
                  onClick={() => setActiveKPIId('cycleTime')}
                  hint="Click for details"
                />
                <KpiCard
                  label="Specific Energy Consumption (SEC)"
                  value={activeKpis ? `${activeKpis.sec_kwh_per_kg.toFixed(2)} kWh/kg` : '—'}
                  icon={<Flame className="h-5 w-5 text-orange-600" />}
                  color="bg-orange-50"
                  onClick={() => setActiveKPIId('sec')}
                  hint="Click for details"
                />
                <KpiCard
                  label="Process Stability"
                  value={activeKpis ? `${activeKpis.process_stability_pct.toFixed(1)}%` : '—'}
                  icon={<Award className="h-5 w-5 text-teal-600" />}
                  color="bg-teal-50"
                  onClick={() => setActiveKPIId('processStability')}
                  hint="Click for details"
                />
                <KpiCard
                  label="OEE"
                  value={activeKpis ? `${activeKpis.oee_pct.toFixed(1)}%` : '—'}
                  icon={<Activity className="h-5 w-5 text-indigo-600" />}
                  color="bg-indigo-50"
                  onClick={() => setActiveKPIId('oee')}
                  hint="Click for details"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Live running-batch summary modal - deliberately lighter than the
          historical KPI modal above: yield/quality/OEE/etc. genuinely don't
          exist yet for a batch that hasn't finished, so this shows what IS
          known (status, scenario, progress) and links out to Process
          Monitoring for the full live detail (predictions, Agent Assessment)
          rather than trying to recreate that view here. */}
      {activeRunningBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 pointer-events-none bg-white/70 backdrop-blur-[2px]">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)] relative w-full max-w-md flex flex-col max-h-full overflow-hidden pointer-events-auto animate-fade-in-content ring-1 ring-black/5">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
              <div>
                <h2 className="text-sm font-bold text-gray-800 uppercase tracking-widest flex items-center gap-2">
                  <Radio size={16} className={activeRunningBatch.status === 'Running' ? 'text-blue-500 animate-pulse' : 'text-gray-400'} /> Live Batch
                </h2>
                <p className="text-xs text-gray-500 font-mono mt-0.5">{activeRunningBatch.running_batch_id}</p>
              </div>
              <button onClick={() => setActiveRunningBatchId(null)} className="p-1 hover:bg-gray-200 rounded-md text-gray-500 transition-colors">
                <XCircle size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Plant</span><span className="font-medium text-gray-800">{activeRunningBatch.plant}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Product</span><span className="font-medium text-gray-800">{activeRunningBatch.product}</span></div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Status</span>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${LIVE_STATUS_STYLES[activeRunningBatch.status] ?? 'bg-gray-100 text-gray-700'}`}>{activeRunningBatch.status}</span>
              </div>
              {/* Scenario/drifting parameter deliberately not shown here -
                  they're simulation inputs (what fault was scripted in
                  before the batch started), not a real outcome. Showing
                  them would spoil what the Deviation Agent is meant to
                  discover from telemetry as it happens, not from a label. */}
              <div className="flex justify-between"><span className="text-gray-500">Current phase</span><span className="font-medium text-gray-800">{activeRunningBatch.phase}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Elapsed / target</span><span className="font-medium text-gray-800">{activeRunningBatch.elapsed_minutes} / {activeRunningBatch.target_duration_minutes} min</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Started</span><span className="font-medium text-gray-800">{formatDateTime(activeRunningBatch.started_at)}</span></div>

              <p className="text-xs text-gray-400 pt-2 border-t border-gray-100">
                Yield, quality, and OEE aren't available yet - this batch hasn't finished.
                {canViewProcessMonitoring
                  ? " For live predictions and the Process Parameter Deviation Agent's assessment, open it in Process Monitoring."
                  : ' Live predictions and the Process Parameter Deviation Agent are available on the Process Monitoring page for personas with access to it.'}
              </p>

              {canViewProcessMonitoring && (
                <button
                  onClick={() => navigate('/process-monitoring')}
                  className="w-full flex items-center justify-center gap-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg py-2.5 transition-colors"
                >
                  Open in Process Monitoring <ExternalLink size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* KPI Education Modal (stacks on top of batch modal at z-[70]) */}
      {activeKPIId && getKPIDefinition(activeKPIId) && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6 pointer-events-none bg-white/70 backdrop-blur-[2px]">
          <div className="pointer-events-auto">
            <KPIInfoModal
              kpiDefinition={getKPIDefinition(activeKPIId)!}
              currentValue={
                activeKPIId === 'cycleTime' ? `${cycleTimeHrs} hrs` :
                activeKPIId === 'yield' && activeKpis ? `${activeKpis.yield_pct.toFixed(1)}%` :
                activeKPIId === 'qualityScore' && activeKpis ? `${activeKpis.quality_score_pct.toFixed(1)}%` :
                activeKPIId === 'sec' && activeKpis ? `${activeKpis.sec_kwh_per_kg.toFixed(2)} kWh/kg` :
                activeKPIId === 'processStability' && activeKpis ? `${activeKpis.process_stability_pct.toFixed(1)}%` :
                activeKPIId === 'oee' && activeKpis ? `${activeKpis.oee_pct.toFixed(1)}%` :
                undefined
              }
              onClose={() => setActiveKPIId(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
