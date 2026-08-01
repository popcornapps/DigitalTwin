import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AIRecommendation, RecommendationStatus } from '../lib/mockData';
import { fetchAlerts, acknowledgeAlert, rejectAlert } from '../lib/api';
import type { DeviationAlert } from '../lib/api';
import {
  Inbox, CheckCircle2, XCircle, Clock,
  Info, Activity, Filter, FileText, Zap, AlertTriangle
} from 'lucide-react';

const ALERTS_POLL_INTERVAL_MS = 3000;

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

// The KPI cards double as the primary filter now - one of the 4 status
// values, or 'Critical' (a priority, not a status) for the Critical
// Attention card. null means "no card active" -> the default-visible set.
type CardFilter = 'New' | 'Acknowledged' | 'Rejected' | 'Resolved' | 'Critical' | null;

function earliestOf(...dates: (string | null)[]): string | null {
  const valid = dates.filter((d): d is string => d != null);
  if (valid.length === 0) return null;
  return valid.reduce((min, d) => (new Date(d).getTime() < new Date(min).getTime() ? d : min));
}

// Real Process Parameter Deviation Agent alerts, shaped to fit this page's
// card/table/modal - this is the ONLY source of recommendations on this page
// now (no mock data mixed in). The narrative fields (alert_summary/
// trigger_explanation/likely_root_cause/recommended_action/
// operational_impact) are the LLM reasoning layer's output, persisted on the
// alert record itself - the same explanation shown in Process Monitoring,
// not re-derived here.
function alertToRecommendation(alert: DeviationAlert): AIRecommendation {
  const titleAction = alert.trigger_type === 'predicted' ? 'predicted to deviate' : 'deviation detected';
  // human_decision (a human explicitly acted) always wins for display status
  // over status==='Resolved' (the agent noticed the deviation cleared on its
  // own, nobody necessarily reviewed it) - these are different signals, see
  // models.DeviationAlert.
  const status: RecommendationStatus =
    alert.human_decision === 'Acknowledged' ? 'Acknowledged'
    : alert.human_decision === 'Rejected' ? 'Rejected'
    : alert.status === 'Resolved' ? 'Resolved'
    : 'New';
  return {
    id: alert.alert_id,
    source: 'Process Parameter Deviation Agent',
    batchId: alert.running_batch_id,
    timestamp: new Date(alert.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    createdDate: alert.created_at,
    // Earliest of the two possible "stop the clock" events - if both a human
    // decision and an agent auto-resolve happened, pending duration stops at
    // whichever came first, not whichever is more recent.
    resolvedDate: earliestOf(alert.human_decision_at, alert.resolved_at),
    priority: alert.urgency ? URGENCY_TO_PRIORITY[alert.urgency] : (alert.severity === 'Critical' ? 'Critical' : 'Medium'),
    status,
    title: alert.alert_summary ?? `${alert.parameter_label} ${titleAction}`,
    description: alert.trigger_explanation ?? [alert.observation, alert.predicted_observation].filter(Boolean).join(' '),
    reasoning: alert.likely_root_cause ?? 'No matching historical fault pattern identified for this deviation yet.',
    expectedBenefit: alert.operational_impact ?? 'Early correction reduces the risk of an out-of-spec batch.',
    suggestedAction: alert.recommended_action ?? 'Continue monitoring - no specific corrective action identified yet.',
    plant: alert.plant,
    product: 'Paracetamol 500mg',
  };
}

// Real elapsed time from createdDate to whichever of resolvedDate/"now"
// applies - replaces the old hardcoded-"today" age math, and actually stops
// counting once something's been acknowledged/rejected/resolved instead of
// running forever.
function formatDuration(createdDateISO: string, resolvedDateISO?: string | null): string {
  const start = new Date(createdDateISO).getTime();
  const end = resolvedDateISO ? new Date(resolvedDateISO).getTime() : Date.now();
  const ms = Math.max(0, end - start);
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours !== 1 ? 's' : ''}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? 's' : ''}`;
}

// Overdue: Critical priority, still unaddressed (status New), open more than
// 7 real days - same threshold as before, just computed against the real
// current time instead of a hardcoded fake "today".
function isOverdue(rec: AIRecommendation): boolean {
  if (rec.priority !== 'Critical' || rec.status !== 'New') return false;
  const ms = Date.now() - new Date(rec.createdDate).getTime();
  return ms > 7 * 24 * 60 * 60 * 1000;
}

const RECENT_HANDLED_WINDOW_MS = 24 * 60 * 60 * 1000;

// "Just handled" - Acknowledged, Rejected, or Resolved within the last 24
// hours, using the same earliest-of-(human_decision_at, resolved_at)
// timestamp already computed onto resolvedDate.
function isRecentlyHandled(rec: AIRecommendation): boolean {
  if (rec.status === 'New' || !rec.resolvedDate) return false;
  return Date.now() - new Date(rec.resolvedDate).getTime() <= RECENT_HANDLED_WINDOW_MS;
}

// Default visibility rule for the main Recommendation Log (when no KPI card
// filter is active) - a UI display filter only, nothing is ever deleted
// from the persisted alert store (see alert_registry.py). Still-open alerts
// and Critical-priority ones always show regardless of age; anything else
// only shows for its first 24 hours after being handled, then rolls off
// into History-only.
function isDefaultVisible(rec: AIRecommendation): boolean {
  return rec.status === 'New' || rec.priority === 'Critical' || isRecentlyHandled(rec);
}

const CARD_LABELS: Record<Exclude<CardFilter, null>, string> = {
  New: 'New',
  Acknowledged: 'Acknowledged',
  Rejected: 'Rejected',
  Resolved: 'Resolved',
  Critical: 'Critical',
};

export default function ReviewDesk() {
  // The KPI cards ARE the primary filter now - one active card (or null for
  // the smart default view). Priority/Source remain separate dimensions,
  // combined on top of whichever card (or default set) is active.
  const [activeCardFilter, setActiveCardFilter] = useState<CardFilter>(null);
  const [filterPriority, setFilterPriority] = useState<string>('All');
  const [filterSource, setFilterSource] = useState<string>('All');

  const [activeRecId, setActiveRecId] = useState<string | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);

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

  const recommendations: AIRecommendation[] = useMemo(
    () => realAlerts.map(alertToRecommendation),
    [realAlerts],
  );

  // Acknowledge/Reject are real backend actions now - persisted on the alert
  // record itself (survives refreshes and backend restarts), not a local
  // browser-only override. The response is applied immediately so the UI
  // doesn't have to wait for the next 5s poll to reflect the click.
  const handleAction = async (id: string, action: 'Acknowledged' | 'Rejected') => {
    try {
      const updated = action === 'Acknowledged' ? await acknowledgeAlert(id) : await rejectAlert(id);
      setRealAlerts((prev) => prev.map((a) => (a.alert_id === id ? updated : a)));
    } catch {
      // Leave state as-is; the next poll reconciles with the backend, and
      // the user can just try the action again.
    }
    setActiveRecId(null);
  };

  const toggleCardFilter = (key: Exclude<CardFilter, null>) => {
    setActiveCardFilter((prev) => (prev === key ? null : key));
  };

  // Default-visible set - used only when no KPI card filter is active.
  const visibleRecs = useMemo(() => recommendations.filter(isDefaultVisible), [recommendations]);

  // A KPI card filter deliberately bypasses the 24h-recency default and
  // shows the COMPLETE set matching that one criterion - clicking "Resolved"
  // would be pointless if it only showed the same last-24h slice already
  // visible by default. Priority/Source then narrow further on top.
  const filteredRecs = useMemo(() => {
    const base = activeCardFilter
      ? recommendations.filter(r => (activeCardFilter === 'Critical' ? r.priority === 'Critical' : r.status === activeCardFilter))
      : visibleRecs;
    return base.filter(r => {
      const matchPriority = filterPriority === 'All' || r.priority === filterPriority;
      const matchSource = filterSource === 'All' || r.source === filterSource;
      return matchPriority && matchSource;
    });
  }, [activeCardFilter, recommendations, visibleRecs, filterPriority, filterSource]);

  // Derived sources for the filter dropdown - drawn from the full history so
  // it works correctly regardless of which card (if any) is active.
  const uniqueSources = useMemo(() => {
    const sources = new Set(recommendations.map(r => r.source));
    return ['All', ...Array.from(sources)];
  }, [recommendations]);

  // KPI Calculations - always all-time totals, regardless of which card (if
  // any) is currently selected as the active filter.
  const kpiNew = recommendations.filter(r => r.status === 'New').length;
  const kpiAck = recommendations.filter(r => r.status === 'Acknowledged').length;
  const kpiRej = recommendations.filter(r => r.status === 'Rejected').length;
  const kpiResolved = recommendations.filter(r => r.status === 'Resolved').length;

  // Critical Attention KPIs
  const criticalRecs = recommendations.filter(r => r.priority === 'Critical');
  const kpiCriticalOpen = criticalRecs.filter(r => r.status === 'New').length;
  const kpiOverdueCritical = criticalRecs.filter(r => isOverdue(r)).length;
  const oldestCriticalOpen = criticalRecs
    .filter(r => r.status === 'New')
    .sort((a, b) => new Date(a.createdDate).getTime() - new Date(b.createdDate).getTime())[0];
  const kpiOldestPending = oldestCriticalOpen ? formatDuration(oldestCriticalOpen.createdDate) : 'N/A';

  const activeRec = recommendations.find(r => r.id === activeRecId) || null;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-2 border-b border-gray-200 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[11.25px] font-extrabold uppercase bg-indigo-50 text-indigo-600 border border-indigo-200 tracking-wider">
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

      {/* KPI Cards Row - now the primary filter control, click to filter the log below */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KPICard
          title="New" value={kpiNew} icon={<Zap />} color="text-indigo-600" bg="bg-indigo-50"
          isActive={activeCardFilter === 'New'} onClick={() => toggleCardFilter('New')}
        />
        <KPICard
          title="Acknowledged" value={kpiAck} icon={<CheckCircle2 />} color="text-emerald-600" bg="bg-emerald-50"
          isActive={activeCardFilter === 'Acknowledged'} onClick={() => toggleCardFilter('Acknowledged')}
        />
        <KPICard
          title="Rejected" value={kpiRej} icon={<XCircle />} color="text-rose-600" bg="bg-rose-50"
          isActive={activeCardFilter === 'Rejected'} onClick={() => toggleCardFilter('Rejected')}
        />
        <KPICard
          title="Resolved" value={kpiResolved} icon={<Activity />} color="text-teal-600" bg="bg-teal-50"
          isActive={activeCardFilter === 'Resolved'} onClick={() => toggleCardFilter('Resolved')}
        />
        <CriticalAttentionCard
          criticalOpen={kpiCriticalOpen}
          overdueCritical={kpiOverdueCritical}
          oldestPending={kpiOldestPending}
          isActive={activeCardFilter === 'Critical'}
          onClick={() => toggleCardFilter('Critical')}
        />
      </div>

      {/* Local Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between border-b border-gray-100 pb-2">
        <div className="flex items-center gap-2 text-sm text-gray-400 font-bold shrink-0">
          <Filter size={14} /> FILTERS
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full">
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
          <div className="px-5 py-4 border-b border-gray-50 flex justify-between items-center flex-wrap gap-2">
            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-widest flex items-center gap-2">
              <FileText size={16} className="text-gray-400" /> Recommendation Log
            </h2>
            <div className="flex items-center gap-3">
              {activeCardFilter && (
                <span className="text-[12.38px] font-bold text-gray-500">
                  Showing: {CARD_LABELS[activeCardFilter]}
                  <button
                    onClick={() => setActiveCardFilter(null)}
                    className="ml-2 text-indigo-600 hover:text-indigo-800 normal-case font-bold"
                  >
                    Show All ×
                  </button>
                </span>
              )}
              <span className="text-[11.25px] font-bold text-gray-400">
                {filteredRecs.length} items
                {!activeCardFilter && recommendations.length > visibleRecs.length && (
                  <span className="font-semibold normal-case text-gray-400"> · {recommendations.length - visibleRecs.length} older in History</span>
                )}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100 text-gray-400">
                  <th className="px-5 py-3 text-[11.25px] font-bold uppercase tracking-wider">ID & Time</th>
                  <th className="px-4 py-3 text-[11.25px] font-bold text-gray-400 uppercase tracking-wider">Title & Source</th>
                  <th className="px-4 py-3 text-[11.25px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">Batch ID</th>
                  <th className="px-4 py-3 text-[11.25px] font-bold text-gray-400 uppercase tracking-wider">Priority</th>
                  <th className="px-4 py-3 text-[11.25px] font-bold text-gray-400 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredRecs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-sm font-semibold text-gray-400">
                      {activeCardFilter
                        ? `No ${CARD_LABELS[activeCardFilter]} alerts recorded.`
                        : visibleRecs.length === 0
                        ? 'No alerts currently need attention. Anything resolved or handled has rolled off into History.'
                        : 'No recommendations match the current filters.'}
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
                          <div className="text-[11.25px] text-gray-400 font-bold mt-0.5">{rec.timestamp}</div>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-bold text-gray-800">{rec.title}</div>
                            {rec.priority === 'Critical' && rec.status === 'New' && (
                              <span className="inline-flex px-1.5 py-0.5 rounded text-[10.13px] font-black uppercase tracking-wider bg-rose-100 text-rose-700 border border-rose-200">
                                Critical
                              </span>
                            )}
                            {isOverdue(rec) && (
                              <span className="inline-flex px-1.5 py-0.5 rounded text-[10.13px] font-black uppercase tracking-wider bg-orange-100 text-orange-700 border border-orange-200">
                                Overdue
                              </span>
                            )}
                          </div>
                          <div className="text-[11.25px] text-gray-500 font-bold mt-1 max-w-[225px] truncate">{rec.source}</div>
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
      {activeRec && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-white/70 backdrop-blur-[2px]" onClick={() => setActiveRecId(null)}>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)] relative w-full max-w-2xl flex flex-col max-h-full overflow-hidden pointer-events-auto animate-fade-in-content ring-1 ring-black/5" onClick={(e) => e.stopPropagation()}>
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
                  <span className="text-[11.25px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Created</span>
                  <p className="text-sm font-bold text-gray-800">{activeRec.timestamp}</p>
                </div>
                <div>
                  <span className="text-[11.25px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Pending Duration</span>
                  <p className="text-sm font-bold text-gray-800">
                    {formatDuration(activeRec.createdDate, activeRec.resolvedDate)}
                    {!activeRec.resolvedDate && <span className="ml-1.5 font-semibold text-amber-600 text-xs">(ongoing)</span>}
                  </p>
                </div>
              </div>

              <div>
                <span className="text-[11.25px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">Description</span>
                <div className="text-sm text-gray-700 leading-relaxed font-medium bg-indigo-50/30 p-4 rounded-xl border border-indigo-100/50">
                  <p>{activeRec.description}</p>
                </div>
              </div>

              <div>
                <span className="text-[11.25px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">Reasoning</span>
                <div className="text-sm text-gray-700 leading-relaxed font-medium bg-slate-50 p-4 rounded-xl border border-gray-100">
                  <p>{activeRec.reasoning}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-gray-50 p-4 rounded-xl border border-gray-100">
                <div>
                  <span className="text-[11.25px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">Suggested Action</span>
                  <p className="text-sm text-gray-900 leading-relaxed font-bold whitespace-pre-line">{activeRec.suggestedAction}</p>
                </div>
                <div>
                  <span className="text-[11.25px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">Expected Benefit</span>
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
        </div>,
        document.body
      )}

      {/* History Modal - real alert history (Open/Acknowledged/Rejected/
          Resolved), not mock activity. Every alert the agent has ever
          generated shows up here, since alert_registry never deletes one -
          it only changes status. */}
      {showHistoryModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-white/70 backdrop-blur-[2px]" onClick={() => setShowHistoryModal(false)}>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)] relative w-full max-w-2xl flex flex-col max-h-full overflow-hidden pointer-events-auto animate-fade-in-content ring-1 ring-black/5" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
              <h2 className="text-sm font-bold text-gray-800 uppercase tracking-widest flex items-center gap-2">
                <Activity size={16} className="text-teal-500" /> Alert History
              </h2>
              <button onClick={() => setShowHistoryModal(false)} className="p-1 hover:bg-gray-200 rounded-md text-gray-500 transition-colors">
                <XCircle size={18} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {recommendations.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No alerts recorded yet.</p>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-gray-100 text-gray-400">
                      <th className="px-5 py-3 text-[11.25px] font-bold uppercase tracking-wider whitespace-nowrap">Time</th>
                      <th className="px-4 py-3 text-[11.25px] font-bold uppercase tracking-wider">Title</th>
                      <th className="px-4 py-3 text-[11.25px] font-bold uppercase tracking-wider whitespace-nowrap">Batch</th>
                      <th className="px-5 py-3 text-[11.25px] font-bold uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {recommendations.map((rec) => (
                      <tr key={rec.id} className="hover:bg-gray-50/50">
                        <td className="px-5 py-3 align-top whitespace-nowrap">
                          <div className="text-xs font-bold text-gray-700">{rec.timestamp}</div>
                          <div className="text-[11.25px] text-gray-400">{new Date(rec.createdDate).toLocaleDateString()}</div>
                        </td>
                        <td className="px-4 py-3 align-top text-sm text-gray-800 font-medium max-w-[293px] truncate">{rec.title}</td>
                        <td className="px-4 py-3 align-top whitespace-nowrap text-xs font-bold text-gray-500">{rec.batchId}</td>
                        <td className="px-5 py-3 align-top">
                          <Badge type="status" value={rec.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}

function KPICard({ title, value, icon, color, bg, isActive, onClick }: {
  title: string, value: number, icon: React.ReactNode, color: string, bg: string,
  isActive: boolean, onClick: () => void,
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-white rounded-xl border shadow-sm p-4 flex items-center gap-3 transition-all hover:shadow-md ${
        isActive ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-gray-100 hover:border-gray-200'
      }`}
    >
      <div className={`p-2.5 rounded-lg ${bg} ${color}`}>
        {React.cloneElement(icon as React.ReactElement, { size: 18 })}
      </div>
      <div>
        <p className="text-xl font-black text-gray-900 leading-none">{value}</p>
        <p className="text-[11.25px] text-gray-500 font-bold uppercase tracking-wider leading-tight mt-1">{title}</p>
      </div>
    </button>
  );
}

function CriticalAttentionCard({ criticalOpen, overdueCritical, oldestPending, isActive, onClick }: {
  criticalOpen: number, overdueCritical: number, oldestPending: string,
  isActive: boolean, onClick: () => void,
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-white rounded-xl border shadow-sm p-4 transition-all hover:shadow-md ${
        isActive ? 'border-orange-400 ring-2 ring-orange-100' : 'border-gray-100 hover:border-gray-200'
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 rounded-lg bg-orange-50 text-orange-600">
          <AlertTriangle size={18} />
        </div>
        <p className="text-[11.25px] text-gray-500 font-bold uppercase tracking-wider leading-tight">Critical Attention</p>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-[11.25px] text-gray-500 font-semibold uppercase tracking-wide">Critical Open</span>
          <span className="text-base font-black text-rose-600">{criticalOpen}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[11.25px] text-gray-500 font-semibold uppercase tracking-wide">Overdue Critical</span>
          <span className="text-base font-black text-orange-600">{overdueCritical}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[11.25px] text-gray-500 font-semibold uppercase tracking-wide">Oldest Pending</span>
          <span className="text-base font-black text-gray-700">{oldestPending}</span>
        </div>
      </div>
    </button>
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
    else if (value === 'Acknowledged') styles = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    else if (value === 'Rejected') styles = 'bg-gray-100 text-gray-500 border-gray-200';
    else if (value === 'Resolved') styles = 'bg-teal-50 text-teal-700 border-teal-200';
  }

  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-[11.25px] font-bold uppercase tracking-wider border ${styles}`}>
      {value}
    </span>
  );
}
