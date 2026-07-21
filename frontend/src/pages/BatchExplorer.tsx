import { useState, useMemo } from 'react';
import { getMockBatchHistory, getMockBatchKPIs } from '../lib/mockData';
import { Search, Activity, ShieldCheck, Clock, Flame, Award, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useFilter } from '../context/FilterContext';
import { KPIInfoModal } from '../components/KPIInfoModal';
import { getKPIDefinition } from '../lib/kpiDefinitions';

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

export default function BatchExplorer() {
  const { selectedPlant, selectedProduct, setSelectedBatch } = useFilter();
  const mockBatchHistory = getMockBatchHistory(selectedPlant, selectedProduct);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [yieldSort, setYieldSort] = useState('None');
  const [qualitySort, setQualitySort] = useState('None');
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [activeKPIId, setActiveKPIId] = useState<string | null>(null);

  const activeBatchKPIs = activeBatchId ? getMockBatchKPIs(activeBatchId) : null;

  const closeBatchModal = () => {
    setActiveBatchId(null);
    setActiveKPIId(null);
  };

  const filteredAndSortedBatches = useMemo(() => {
    let result = [...mockBatchHistory];

    // Search filter
    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter(b => 
        b.id.toLowerCase().includes(s) || 
        b.product.toLowerCase().includes(s)
      );
    }

    // Status filter
    if (statusFilter !== 'All') {
      if (statusFilter === 'Running') {
        result = result.filter(b => b.status === 'In Progress');
      } else if (statusFilter === 'Completed') {
        result = result.filter(b => b.status === 'Completed');
      }
    }

    // Extract numbers for sorting
    const parseValue = (val: string) => {
      if (val === '-' || !val) return -1;
      return parseFloat(val.replace('%', ''));
    };

    // Sorting overrides (Yield gets priority if active, then Quality, otherwise ID)
    if (yieldSort !== 'None') {
      result.sort((a, b) => {
        const vA = parseValue(a.yield);
        const vB = parseValue(b.yield);
        return yieldSort === 'Highest' ? vB - vA : vA - vB;
      });
    } else if (qualitySort !== 'None') {
      result.sort((a, b) => {
        const vA = parseValue(a.quality);
        const vB = parseValue(b.quality);
        return qualitySort === 'Highest' ? vB - vA : vA - vB;
      });
    }

    return result;
  }, [mockBatchHistory, search, statusFilter, yieldSort, qualitySort]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Batch Explorer</h1>
          <p className="text-sm text-gray-500">Browsing batches for {selectedPlant} | {selectedProduct}</p>
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
              value={yieldSort}
              onChange={(e) => { setYieldSort(e.target.value); setQualitySort('None'); }}
              className="bg-white border border-gray-200 text-sm text-gray-700 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="None">-</option>
              <option value="Highest">Highest</option>
              <option value="Lowest">Lowest</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 uppercase">Quality:</span>
            <select 
              value={qualitySort}
              onChange={(e) => { setQualitySort(e.target.value); setYieldSort('None'); }}
              className="bg-white border border-gray-200 text-sm text-gray-700 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="None">-</option>
              <option value="Highest">Highest</option>
              <option value="Lowest">Lowest</option>
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
              <th className="px-6 py-4 font-semibold">Yield</th>
              <th className="px-6 py-4 font-semibold">Quality</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredAndSortedBatches.map((batch) => (
              <tr
                key={batch.id}
                className="hover:bg-gray-50 cursor-pointer"
                onClick={() => {
                  setSelectedBatch(batch.id);
                  setActiveBatchId(batch.id);
                }}
              >
                <td className="px-6 py-4 font-medium text-blue-600 cursor-pointer">{batch.id}</td>
                <td className="px-6 py-4">{batch.product}</td>
                <td className="px-6 py-4">{batch.start}</td>
                <td className="px-6 py-4">{batch.end}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${batch.status === 'Completed' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                    {batch.status}
                  </span>
                </td>
                <td className="px-6 py-4 font-medium text-gray-900">{batch.yield}</td>
                <td className="px-6 py-4 font-medium text-gray-900">{batch.quality}</td>
              </tr>
            ))}
            {filteredAndSortedBatches.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                  No batches found matching the selected criteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {activeBatchId && activeBatchKPIs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 pointer-events-none bg-white/70 backdrop-blur-[2px]">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)] relative w-full max-w-2xl flex flex-col max-h-full overflow-hidden pointer-events-auto animate-fade-in-content ring-1 ring-black/5">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
              <div>
                <h2 className="text-sm font-bold text-gray-800 uppercase tracking-widest flex items-center gap-2">
                  <Activity size={16} className="text-indigo-500" /> Batch KPIs
                </h2>
                <p className="text-xs text-gray-500 font-mono mt-0.5">{activeBatchId}</p>
              </div>
              <button onClick={closeBatchModal} className="p-1 hover:bg-gray-200 rounded-md text-gray-500 transition-colors">
                <XCircle size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-4">
                <KpiCard label="Yield" value={`${activeBatchKPIs.yield}%`} icon={<Activity className="h-5 w-5 text-emerald-600" />} color="bg-emerald-50" onClick={() => setActiveKPIId('yield')} hint="Click for details" />
                <KpiCard label="Quality Score" value={`${activeBatchKPIs.qualityScore}%`} icon={<ShieldCheck className="h-5 w-5 text-rose-600" />} color="bg-rose-50" onClick={() => setActiveKPIId('qualityScore')} hint="Click for details" />
                <KpiCard label="Cycle Time" value={`${activeBatchKPIs.cycleTimeHrs} hrs`} icon={<Clock className="h-5 w-5 text-blue-600" />} color="bg-blue-50" onClick={() => setActiveKPIId('cycleTime')} hint="Click for details" />
                <KpiCard label="Specific Energy Consumption (SEC)" value={`${activeBatchKPIs.sec} kWh/kg`} icon={<Flame className="h-5 w-5 text-orange-600" />} color="bg-orange-50" onClick={() => setActiveKPIId('sec')} hint="Click for details" />
                <KpiCard label="Process Stability" value={`${activeBatchKPIs.processStability}%`} icon={<Award className="h-5 w-5 text-teal-600" />} color="bg-teal-50" onClick={() => setActiveKPIId('processStability')} hint="Click for details" />
                <KpiCard
                  label="OEE"
                  value={`${activeBatchKPIs.oee}%`}
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
      {activeKPIId && activeBatchKPIs && getKPIDefinition(activeKPIId) && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6 pointer-events-none bg-white/70 backdrop-blur-[2px]">
          <div className="pointer-events-auto">
            <KPIInfoModal
              kpiDefinition={getKPIDefinition(activeKPIId)!}
              currentValue={
                activeKPIId === 'yield' ? `${activeBatchKPIs.yield}%` :
                activeKPIId === 'qualityScore' ? `${activeBatchKPIs.qualityScore}%` :
                activeKPIId === 'cycleTime' ? `${activeBatchKPIs.cycleTimeHrs} hrs` :
                activeKPIId === 'sec' ? `${activeBatchKPIs.sec} kWh/kg` :
                activeKPIId === 'processStability' ? `${activeBatchKPIs.processStability}%` :
                activeKPIId === 'oee' ? `${activeBatchKPIs.oee}%` :
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
