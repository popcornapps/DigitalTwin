import React, { useState, useEffect, useMemo } from 'react';
import { useFilter } from '../context/FilterContext';
import { getMockRecommendations, getMockActivity, AIRecommendation, RecommendationStatus } from '../lib/mockData';
import { fetchAlerts } from '../lib/api';
import type { DeviationAlert } from '../lib/api';
import {
  Inbox, CheckCircle2, XCircle, Clock,
  Info, Activity, Filter, FileText, Zap, AlertTriangle
} from 'lucide-react';

const ALERTS_POLL_INTERVAL_MS = 5000;

// Urgency (the LLM reasoning layer's operational-priority call, factoring in
// severity + time-to-breach) maps onto this page's 3-level priority - more
// informative than deriving priority from severity alone, since it already
// accounts for how much time is actually left.
const URGENCY_TO_PRIORITY: Record<string, 'Critical' | 'Medium' | 'Low'> = {
  'Immediate Action Required': 'Critical',
  'Action Recommended Soon': 'Medium',
  'Monitor Closely': 'Low',
  'Informational Only': 'Low',
};

// Real Process Parameter Deviation Agent alerts, shaped to fit the same
// AIRecommendation card/table/modal this page already renders - additive to
// the existing mock inbox, not a replacement of it. This is what closes the
// loop: prediction -> alert -> shows up here -> gets acted on. The narrative
// fields (alert_summary/trigger_explanation/likely_root_cause/
// recommended_action/operational_impact) are the LLM reasoning layer's
// output, persisted on the alert record itself - the same explanation shown
// in Process Monitoring, not re-derived here.
function alertToRecommendation(alert: DeviationAlert): AIRecommendation {
  const titleAction = alert.trigger_type === 'predicted' ? 'predicted to deviate' : 'deviation detected';
  return {
    id: alert.alert_id,
    source: 'Process Parameter Deviation Agent',
    batchId: alert.running_batch_id,
    timestamp: new Date(alert.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    createdDate: alert.created_at,
    priority: alert.urgency ? URGENCY_TO_PRIORITY[alert.urgency] : (alert.severity === 'Critical' ? 'Critical' : 'Medium'),
    // The AIRecommendation status union has no "Resolved" - closest honest
    // mapping is Acknowledged (the situation is closed), unless a human has
    // already applied their own status locally (handled by the merge below).
    status: alert.status === 'Resolved' ? 'Acknowledged' : 'New',
    title: alert.alert_summary ?? `${alert.parameter_label} ${titleAction}`,
    description: alert.trigger_explanation ?? [alert.observation, alert.predicted_observation].filter(Boolean).join(' '),
    reasoning: alert.likely_root_cause ?? 'No matching historical fault pattern identified for this deviation yet.',
    expectedBenefit: alert.operational_impact ?? 'Early correction reduces the risk of an out-of-spec batch.',
    suggestedAction: alert.recommended_action ?? 'Continue monitoring - no specific corrective action identified yet.',
    plant: alert.plant,
    product: 'Paracetamol 500mg',
  };
}

// Returns age in days from createdDate ISO string to "today" (2026-07-20)
function getAgeDays(createdDateISO: string): number {
  const created = new Date(createdDateISO);
  const now = new Date('2026-07-20T00:00:00Z'); // Hardcoded "today" per CLAUDE.md
  return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
}

// Returns true if rec is overdue (Critical + New/Pending + >7 days old)
function isOverdue(rec: AIRecommendation): boolean {
  return rec.priority === 'Critical' &&
         (rec.status === 'New' || rec.status === 'Pending') &&
         getAgeDays(rec.createdDate) > 7;
}

export default function ReviewDesk() {
  const { selectedPlant, selectedProduct, selectedPersona } = useFilter();

  // Local state for filters
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterPriority, setFilterPriority] = useState<string>('All');
  const [filterSource, setFilterSource] = useState<string>('All');

  const [activeRecId, setActiveRecId] = useState<string | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  // Local Acknowledge/Reject actions, keyed by id - applied on top of
  // whatever the mock data or the real alert feed says, so a poll refresh
  // (every 5s) can't silently undo a click the user already made.
  const [statusOverrides, setStatusOverrides] = useState<Record<string, RecommendationStatus>>({});

  const mockRecs = useMemo(() => getMockRecommendations(selectedPlant, selectedProduct, selectedPersona), [selectedPlant, selectedProduct, selectedPersona]);
  const activityLog = useMemo(() => getMockActivity(), []);

  const [realAlerts, setRealAlerts] = useState<DeviationAlert[]>([]);
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetchAlerts()
        .then((alerts) => {
          if (!cancelled) setRealAlerts(alerts);
        })
        .catch(() => {
          // A transient poll failure just keeps showing the last known alerts.
        });
    };
    poll();
    const interval = setInterval(poll, ALERTS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const recommendations: AIRecommendation[] = useMemo(() => {
    const combined = [...realAlerts.map(alertToRecommendation), ...mockRecs];
    return combined.map((r) => (statusOverrides[r.id] ? { ...r, status: statusOverrides[r.id] } : r));
  }, [mockRecs, realAlerts, statusOverrides]);

  const handleAction = (id: string, newStatus: RecommendationStatus) => {
    setStatusOverrides((prev) => ({ ...prev, [id]: newStatus }));
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

  // Critical Attention KPIs
  const criticalRecs = recommendations.filter(r => r.priority === 'Critical');
  const kpiCriticalOpen = criticalRecs.filter(r => r.status === 'New' || r.status === 'Pending').length;
  const kpiOverdueCritical = criticalRecs.filter(r => isOverdue(r)).length;
  const oldestCriticalPending = criticalRecs
    .filter(r => r.status === 'Pending')
    .sort((a, b) => new Date(a.createdDate).getTime() - new Date(b.createdDate).getTime())[0];
  const kpiOldestPending = oldestCriticalPending ? `${getAgeDays(oldestCriticalPending.createdDate)} Days` : 'N/A';

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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KPICard title="New" value={kpiNew} icon={<Zap />} color="text-indigo-600" bg="bg-indigo-50" />
        <KPICard title="Pending Review" value={kpiPending} icon={<Clock />} color="text-amber-600" bg="bg-amber-50" />
        <KPICard title="Acknowledged" value={kpiAck} icon={<CheckCircle2 />} color="text-emerald-600" bg="bg-emerald-50" />
        <KPICard title="Rejected" value={kpiRej} icon={<XCircle />} color="text-rose-600" bg="bg-rose-50" />
        <CriticalAttentionCard
          criticalOpen={kpiCriticalOpen}
          overdueCritical={kpiOverdueCritical}
          oldestPending={kpiOldestPending}
        />
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
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-bold text-gray-800">{rec.title}</div>
                            {rec.priority === 'Critical' && (rec.status === 'New' || rec.status === 'Pending') && (
                              <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-rose-100 text-rose-700 border border-rose-200">
                                Critical
                              </span>
                            )}
                            {isOverdue(rec) && (
                              <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-orange-100 text-orange-700 border border-orange-200">
                                Overdue
                              </span>
                            )}
                          </div>
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
                  <div className="flex items-center gap-2">
                    <Badge type="priority" value={activeRec.priority} />
                    <Badge type="status" value={activeRec.status} />
                  </div>
                </div>
                <h3 className="text-xl font-black text-gray-900 leading-tight">{activeRec.title}</h3>
                <div className="text-sm text-gray-500 font-bold mt-1.5 flex items-center gap-2">
                  <span className="bg-gray-100 px-2 py-0.5 rounded border border-gray-200 text-gray-700">Batch: {activeRec.batchId}</span>
                </div>
              </div>

              {/* Metadata Grid */}
              <div className="grid grid-cols-2 gap-4 bg-gray-50/50 p-4 rounded-xl border border-gray-100">
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Created</span>
                  <p className="text-sm font-bold text-gray-800">{activeRec.timestamp}</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Pending Duration</span>
                  <p className="text-sm font-bold text-gray-800">
                    {activeRec.status === 'Pending' || activeRec.status === 'New'
                      ? `${getAgeDays(activeRec.createdDate)} Days`
                      : 'Closed'}
                  </p>
                </div>
              </div>

              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">Description</span>
                <div className="text-sm text-gray-700 leading-relaxed font-medium bg-indigo-50/30 p-4 rounded-xl border border-indigo-100/50">
                  <p>{activeRec.description}</p>
                </div>
              </div>

              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">Reasoning</span>
                <div className="text-sm text-gray-700 leading-relaxed font-medium bg-slate-50 p-4 rounded-xl border border-gray-100">
                  <p>{activeRec.reasoning}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-gray-50 p-4 rounded-xl border border-gray-100">
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">Suggested Action</span>
                  <p className="text-sm text-gray-900 leading-relaxed font-bold whitespace-pre-line">{activeRec.suggestedAction}</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">Expected Benefit</span>
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

function CriticalAttentionCard({ criticalOpen, overdueCritical, oldestPending }: { criticalOpen: number, overdueCritical: number, oldestPending: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 rounded-lg bg-orange-50 text-orange-600">
          <AlertTriangle size={18} />
        </div>
        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider leading-tight">Critical Attention</p>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">Critical Open</span>
          <span className="text-base font-black text-rose-600">{criticalOpen}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">Overdue Critical</span>
          <span className="text-base font-black text-orange-600">{overdueCritical}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">Oldest Pending</span>
          <span className="text-base font-black text-gray-700">{oldestPending}</span>
        </div>
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
