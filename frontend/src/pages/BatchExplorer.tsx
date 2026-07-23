import { useEffect, useMemo, useState } from 'react';
import { Search, Activity, ShieldCheck, Clock, Flame, Award, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { KPIInfoModal } from '../components/KPIInfoModal';
import { getKPIDefinition } from '../lib/kpiDefinitions';
import { fetchBatches, fetchAllBatchKPIs } from '../lib/api';
import type { BatchSummary, BatchKPIs } from '../lib/api';

const SEVERITY_STYLES: Record<string, string> = {
  Normal: 'bg-emerald-100 text-emerald-800',
  Warning: 'bg-amber-100 text-amber-800',
  Critical: 'bg-red-100 text-red-800',
};

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
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [kpis, setKpis] = useState<BatchKPIs[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sortField, setSortField] = useState<'yield' | 'quality' | 'none'>('none');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [activeKPIId, setActiveKPIId] = useState<string | null>(null);

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
    return () => {
      cancelled = true;
    };
  }, []);

  const kpiMap = useMemo(() => new Map(kpis.map((k) => [k.batch_id, k])), [kpis]);

  const activeBatch = batches.find((b) => b.batch_id === activeBatchId) ?? null;
  const activeKpis = activeBatch ? kpiMap.get(activeBatch.batch_id) ?? null : null;
  const cycleTimeHrs = activeBatch ? (activeBatch.batch_duration_minutes / 60).toFixed(2) : null;

  const closeBatchModal = () => {
    setActiveBatchId(null);
    setActiveKPIId(null);
  };

  const filteredAndSortedBatches = useMemo(() => {
    let result = [...batches];

    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter((b) => b.batch_id.toLowerCase().includes(s) || b.product.toLowerCase().includes(s));
    }

    // Every real batch here is historical/completed - there is no live-batch
    // capability behind this app, so "Running" always correctly returns
    // nothing rather than showing a fabricated in-progress batch.
    if (statusFilter === 'Running') {
      result = [];
    }

    if (sortField !== 'none') {
      const key = sortField === 'yield' ? 'yield_pct' : 'quality_score_pct';
      result = [...result].sort((a, b) => {
        const av = kpiMap.get(a.batch_id)?.[key];
        const bv = kpiMap.get(b.batch_id)?.[key];
        if (av === undefined && bv === undefined) return 0;
        if (av === undefined) return 1;
        if (bv === undefined) return -1;
        return sortDir === 'asc' ? av - bv : bv - av;
      });
    }

    return result;
  }, [batches, search, statusFilter, sortField, sortDir, kpiMap]);

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
          <p className="text-sm text-gray-500">Browsing all {batches.length} real generated Paracetamol 500mg batches</p>
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
            {filteredAndSortedBatches.map((batch) => {
              const start = new Date(batch.batch_start_datetime);
              const end = new Date(start.getTime() + batch.batch_duration_minutes * 60_000);
              const batchKpis = kpiMap.get(batch.batch_id);
              return (
                <tr
                  key={batch.batch_id}
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
            })}
            {filteredAndSortedBatches.length === 0 && (
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
