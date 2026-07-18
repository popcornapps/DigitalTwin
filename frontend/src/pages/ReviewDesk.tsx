import React, { useState, useEffect, useMemo } from 'react';
import { useFilter } from '../context/FilterContext';
import { getMockRecommendations, getMockActivity, AIRecommendation, RecommendationStatus } from '../lib/mockData';
import {
  Inbox, CheckCircle2, XCircle, Clock,
  Info, Activity, Filter, FileText, Zap
} from 'lucide-react';

export default function ReviewDesk() {
  const { selectedPlant, selectedProduct, selectedPersona } = useFilter();

  // Local state for filters
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterPriority, setFilterPriority] = useState<string>('All');
  const [filterSource, setFilterSource] = useState<string>('All');

  const [recommendations, setRecommendations] = useState<AIRecommendation[]>([]);
  const [activeRecId, setActiveRecId] = useState<string | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);

  const rawRecs = useMemo(() => getMockRecommendations(selectedPlant, selectedProduct, selectedPersona), [selectedPlant, selectedProduct, selectedPersona]);
  const activityLog = useMemo(() => getMockActivity(), []);

  // Sync state when rawRecs change (e.g. persona switch or plant/product filter)
  useEffect(() => {
    setRecommendations(rawRecs);
  }, [rawRecs]);

  const handleAction = (id: string, newStatus: RecommendationStatus) => {
    setRecommendations(prev => prev.map(r => r.id === id ? { ...r, status: newStatus } : r));
    setActiveRecId(null); // Close modal on action
  };

  // Filter recommendations locally
  const filteredRecs = useMemo(() => {
    return recommendations.filter(r => {
      const matchStatus = filterStatus === 'All' || r.status === filterStatus;
      const matchPriority = filterPriority === 'All' || r.priority === filterPriority;
      const matchSource = filterSource === 'All' || r.source === filterSource;
      return matchStatus && matchPriority && matchSource;
    });
  }, [recommendations, filterStatus, filterPriority, filterSource]);

  // Derived sources for the filter dropdown
  const uniqueSources = useMemo(() => {
    const sources = new Set(recommendations.map(r => r.source));
    return ['All', ...Array.from(sources)];
  }, [recommendations]);

  // KPI Calculations
  const kpiNew = recommendations.filter(r => r.status === 'New').length;
  const kpiPending = recommendations.filter(r => r.status === 'Pending').length;
  const kpiAck = recommendations.filter(r => r.status === 'Acknowledged').length;
  const kpiRej = recommendations.filter(r => r.status === 'Rejected').length;

  const activeRec = recommendations.find(r => r.id === activeRecId) || null;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-2 border-b border-gray-200 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-indigo-50 text-indigo-600 border border-indigo-200 tracking-wider">
              AI Inbox
            </span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mt-1.5 flex items-center gap-2">
            <Inbox className="text-indigo-500" /> Recommendation Inbox
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Centralized hub for tracking and acting on AI-generated recommendations.
          </p>
        </div>
        <div className="mt-4 md:mt-0">
          <button
            onClick={() => setShowHistoryModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-bold shadow-sm hover:bg-gray-50 transition-colors"
          >
            <Clock size={16} className="text-gray-400" /> View History
          </button>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard title="New" value={kpiNew} icon={<Zap />} color="text-indigo-600" bg="bg-indigo-50" />
        <KPICard title="Pending Review" value={kpiPending} icon={<Clock />} color="text-amber-600" bg="bg-amber-50" />
        <KPICard title="Acknowledged" value={kpiAck} icon={<CheckCircle2 />} color="text-emerald-600" bg="bg-emerald-50" />
        <KPICard title="Rejected" value={kpiRej} icon={<XCircle />} color="text-rose-600" bg="bg-rose-50" />
      </div>

      {/* Local Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between border-b border-gray-100 pb-2">
        <div className="flex items-center gap-2 text-sm text-gray-400 font-bold shrink-0">
          <Filter size={14} /> FILTERS
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-gray-50 border border-gray-200 text-xs text-gray-700 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer font-bold"
          >
            <option value="All">All Statuses</option>
            <option value="New">New</option>
            <option value="Pending">Pending</option>
            <option value="Acknowledged">Acknowledged</option>
            <option value="Rejected">Rejected</option>
          </select>

          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="bg-gray-50 border border-gray-200 text-xs text-gray-700 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer font-bold"
          >
            <option value="All">All Priorities</option>
            <option value="Critical">Critical</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>

          <select
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value)}
            className="bg-gray-50 border border-gray-200 text-xs text-gray-700 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer font-bold shrink-0"
          >
            {uniqueSources.map(s => <option key={s} value={s}>{s === 'All' ? 'All Sources' : s}</option>)}
          </select>
        </div>
      </div>

      {/* Main Interface: Full Width List */}
      <div className="flex flex-col gap-4">

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex-1 overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-gray-50 flex justify-between items-center">
            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-widest flex items-center gap-2">
              <FileText size={16} className="text-gray-400" /> Recommendation Log
            </h2>
            <span className="text-[10px] font-bold text-gray-400">
              {filteredRecs.length} items
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100 text-gray-400">
                  <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider">ID & Time</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Title & Source</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">Batch ID</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Priority</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredRecs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-sm font-semibold text-gray-400">
                      No recommendations match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredRecs.map(rec => {
                    const isActive = activeRecId === rec.id;
                    return (
                      <tr
                        key={rec.id}
                        onClick={() => setActiveRecId(rec.id)}
                        className={`cursor-pointer transition-all ${isActive ? 'bg-indigo-50/20' : 'hover:bg-gray-50/50'}`}
                      >
                        <td className="px-5 py-4 align-top whitespace-nowrap">
                          <div className={`text-xs font-black ${isActive ? 'text-indigo-600' : 'text-gray-700'}`}>{rec.id}</div>
                          <div className="text-[10px] text-gray-400 font-bold mt-0.5">{rec.timestamp}</div>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <div className="text-sm font-bold text-gray-800">{rec.title}</div>
                          <div className="text-[10px] text-gray-500 font-bold mt-1 max-w-[200px] truncate">{rec.source}</div>
                        </td>
                        <td className="px-4 py-4 align-top whitespace-nowrap">
                          <div className="text-xs font-bold text-gray-500">
                            {rec.batchId}
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <Badge type="priority" value={rec.priority} />
                        </td>
                        <td className="px-5 py-4 align-top">
                          <Badge type="status" value={rec.status} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>



      {/* Recommendation Preview Modal */}
      {activeRec && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 pointer-events-none bg-white/70 backdrop-blur-[2px]">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)] relative w-full max-w-2xl flex flex-col max-h-full overflow-hidden pointer-events-auto animate-fade-in-content ring-1 ring-black/5">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
              <h2 className="text-sm font-bold text-gray-800 uppercase tracking-widest flex items-center gap-2">
                <Info size={16} className="text-indigo-500" /> Recommendation Preview
              </h2>
              <button onClick={() => setActiveRecId(null)} className="p-1 hover:bg-gray-200 rounded-md text-gray-500 transition-colors">
                <XCircle size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 uppercase tracking-wider">{activeRec.source}</span>
                  <Badge type="priority" value={activeRec.priority} />
                </div>
                <h3 className="text-xl font-black text-gray-900 leading-tight">{activeRec.title}</h3>
                <div className="text-sm text-gray-500 font-bold mt-1.5 flex items-center gap-2">
                  <span className="bg-gray-100 px-2 py-0.5 rounded border border-gray-200 text-gray-700">Batch: {activeRec.batchId}</span>
                </div>
              </div>

              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">AI Summary</span>
                <div className="text-sm text-gray-700 leading-relaxed font-medium bg-indigo-50/30 p-4 rounded-xl border border-indigo-100/50">
                  <p>{activeRec.description}</p>
                  <p className="mt-2">{activeRec.reasoning}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-gray-50 p-4 rounded-xl border border-gray-100">
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">Suggested Action</span>
                  <p className="text-sm text-gray-900 leading-relaxed font-bold">{activeRec.suggestedAction}</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">Expected Outcome</span>
                  <p className="text-sm text-emerald-700 leading-relaxed font-bold">{activeRec.expectedBenefit}</p>
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-gray-100 bg-gray-50 flex gap-3 shrink-0">
              <button
                onClick={() => handleAction(activeRec.id, 'Acknowledged')}
                disabled={activeRec.status === 'Acknowledged'}
                className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-bold transition-colors ${activeRec.status === 'Acknowledged'
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm'
                  }`}
              >
                {activeRec.status === 'Acknowledged' ? 'Already Acknowledged' : 'Acknowledge'}
              </button>
              <button
                onClick={() => handleAction(activeRec.id, 'Rejected')}
                disabled={activeRec.status === 'Rejected'}
                className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-bold transition-colors ${activeRec.status === 'Rejected'
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-white text-rose-600 border border-rose-200 hover:bg-rose-50 shadow-sm'
                  }`}
              >
                {activeRec.status === 'Rejected' ? 'Already Rejected' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 pointer-events-none bg-white/70 backdrop-blur-[2px]">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)] relative w-full max-w-md flex flex-col max-h-full overflow-hidden pointer-events-auto animate-fade-in-content ring-1 ring-black/5">
            <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
              <h2 className="text-sm font-bold text-gray-800 uppercase tracking-widest flex items-center gap-2">
                <Activity size={16} className="text-teal-500" /> Activity History
              </h2>
              <button onClick={() => setShowHistoryModal(false)} className="p-1 hover:bg-gray-200 rounded-md text-gray-500 transition-colors">
                <XCircle size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <div className="space-y-5">
                {activityLog.map((log, i) => (
                  <div key={i} className="flex gap-4 relative">
                    {i !== activityLog.length - 1 && (
                      <div className="absolute top-5 left-1.5 w-px h-full bg-gray-100"></div>
                    )}
                    <div className="w-3 h-3 rounded-full bg-gray-200 border-2 border-white shrink-0 mt-1 z-10 box-content"></div>
                    <div>
                      <p className="text-[10px] font-bold text-teal-600 uppercase tracking-wider mb-0.5">{log.time}</p>
                      <p className="text-sm text-gray-700 font-medium leading-snug">{log.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function KPICard({ title, value, icon, color, bg }: { title: string, value: number, icon: React.ReactNode, color: string, bg: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
      <div className={`p-2.5 rounded-lg ${bg} ${color}`}>
        {React.cloneElement(icon as React.ReactElement, { size: 18 })}
      </div>
      <div>
        <p className="text-xl font-black text-gray-900 leading-none">{value}</p>
        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider leading-tight mt-1">{title}</p>
      </div>
    </div>
  );
}

function Badge({ type, value }: { type: 'priority' | 'status', value: string }) {
  let styles = '';

  if (type === 'priority') {
    if (value === 'Critical') styles = 'bg-rose-100 text-rose-800 border-rose-200';
    else if (value === 'Medium') styles = 'bg-amber-100 text-amber-800 border-amber-200';
    else styles = 'bg-gray-100 text-gray-600 border-gray-200';
  } else {
    if (value === 'New') styles = 'bg-blue-100 text-blue-800 border-blue-200 font-black';
    else if (value === 'Pending') styles = 'bg-amber-50 text-amber-700 border-amber-200';
    else if (value === 'Acknowledged') styles = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    else if (value === 'Rejected') styles = 'bg-gray-100 text-gray-500 border-gray-200';
  }

  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${styles}`}>
      {value}
    </span>
  );
}
