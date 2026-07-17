import { mockAnomalies } from '../lib/mockData';
import { 
  ShieldAlert, Activity, Target, BrainCircuit, ArrowRight,
  CheckCircle, AlertTriangle, AlertCircle, Settings
} from 'lucide-react';

const workflowSteps = [
  { name: 'Raw Material', status: 'healthy' },
  { name: 'Mixing', status: 'healthy' },
  { name: 'Granulation', status: 'healthy' },
  { name: 'Drying', status: 'critical' },
  { name: 'Compression', status: 'healthy' },
  { name: 'Coating', status: 'healthy' },
  { name: 'Packaging', status: 'healthy' },
];

export default function AnomalyIntelligence() {
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex justify-between items-end border-b border-gray-200 pb-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Anomaly Intelligence</h1>
          <p className="text-sm text-gray-500 mt-1">AI-assisted anomaly detection and workflow diagnostics</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Process Health', value: '92%', icon: Activity, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Active Deviations', value: '2', icon: ShieldAlert, color: 'text-red-600', bg: 'bg-red-50' },
          { label: 'Highest Risk Parameter', value: 'Pressure', icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'AI Confidence', value: '96%', icon: BrainCircuit, color: 'text-indigo-600', bg: 'bg-indigo-50' },
        ].map((kpi, idx) => (
          <div key={idx} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center gap-4">
             <div className={`p-3 rounded-lg ${kpi.bg} ${kpi.color}`}>
                <kpi.icon size={24} />
             </div>
             <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{kpi.label}</div>
                <div className="text-2xl font-bold text-gray-900">{kpi.value}</div>
             </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left/Main Column */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Process Health Overview */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
               <Activity className="text-emerald-600 h-5 w-5" /> Process Health Overview
            </h2>
            
            <div className="flex flex-col md:flex-row items-center gap-6 mb-6">
               <div className="w-full md:flex-1">
                 <div className="flex justify-between items-end mb-2">
                   <span className="text-sm font-semibold text-gray-700">Overall Score</span>
                   <span className="text-2xl font-bold text-emerald-600">92%</span>
                 </div>
                 <div className="w-full bg-gray-100 rounded-full h-3">
                    <div className="bg-emerald-500 h-3 rounded-full" style={{ width: '92%' }}></div>
                 </div>
               </div>
               <div className="w-px h-12 bg-gray-200 hidden md:block"></div>
               <div className="w-full md:flex-1 text-sm text-gray-600 leading-relaxed">
                 Manufacturing process is operating normally with <span className="font-semibold text-gray-900">two detected deviations</span> requiring attention. Overall batch quality remains within acceptable limits.
               </div>
            </div>

            {/* Workflow Visual */}
            <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 overflow-x-auto mt-auto">
               <div className="flex items-center min-w-max gap-2">
                 {workflowSteps.map((step, idx) => (
                   <div key={idx} className="flex items-center">
                     <div className={`flex flex-col items-center justify-center py-3 px-4 rounded-lg border bg-white ${step.status === 'critical' ? 'border-red-300 shadow-sm ring-1 ring-red-50' : 'border-gray-200 shadow-sm'}`}>
                        <div className={`w-3 h-3 rounded-full mb-2 ${step.status === 'healthy' ? 'bg-emerald-500' : step.status === 'critical' ? 'bg-red-500' : 'bg-amber-500'}`}></div>
                        <span className={`text-xs font-bold tracking-wide ${step.status === 'critical' ? 'text-red-700' : 'text-gray-700'}`}>{step.name}</span>
                     </div>
                     {idx < workflowSteps.length - 1 && (
                       <ArrowRight className="text-gray-400 mx-2 h-4 w-4" />
                     )}
                   </div>
                 ))}
               </div>
            </div>
          </div>

          {/* AI Root Cause Analysis */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col md:flex-row gap-8">
             <div className="flex-1 space-y-4">
                <div className="flex justify-between items-start">
                   <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                     <BrainCircuit className="text-indigo-600 h-5 w-5" /> AI Root Cause Analysis
                   </h2>
                   <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                     96% Confidence
                   </span>
                </div>
                
                <div>
                  <p className="text-sm text-gray-500 font-semibold uppercase tracking-wider mb-2">Primary Cause</p>
                  <p className="text-sm text-gray-700 bg-gray-50 p-4 rounded-xl border border-gray-100 leading-relaxed">
                    Pressure exceeded the normal operating range due to increased flow rate during the drying stage. The secondary variable impacting this deviation was anomalous inlet temperature fluctuations during the prior 15 minutes.
                  </p>
                </div>
             </div>
             
             <div className="flex-1 space-y-4 md:border-l md:border-gray-200 md:pl-8">
               <h3 className="text-sm text-gray-500 font-semibold uppercase tracking-wider flex items-center gap-2">
                 <Settings className="text-gray-400 h-4 w-4" /> Recommended Actions
               </h3>
               <ul className="space-y-3 text-sm text-gray-700 mt-3">
                 <li className="flex items-start">
                    <CheckCircle className="h-4 w-4 text-emerald-500 mr-2.5 mt-0.5 flex-shrink-0" />
                    <span>Reduce flow rate by 3%</span>
                 </li>
                 <li className="flex items-start">
                    <CheckCircle className="h-4 w-4 text-emerald-500 mr-2.5 mt-0.5 flex-shrink-0" />
                    <span>Verify pressure sensor calibration</span>
                 </li>
                 <li className="flex items-start">
                    <CheckCircle className="h-4 w-4 text-emerald-500 mr-2.5 mt-0.5 flex-shrink-0" />
                    <span>Continue monitoring for the next production cycle</span>
                 </li>
               </ul>

               <div className="mt-5 bg-emerald-50 rounded-xl p-4 border border-emerald-100">
                 <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wider mb-2">Expected Outcome</div>
                 <p className="text-sm text-emerald-800 leading-snug font-medium">Pressure returns within control limits. Process Health improves and batch continues without interruption.</p>
               </div>
             </div>
          </div>
        </div>

        {/* Right Column: Active Deviations */}
        <div className="space-y-4 flex flex-col h-full bg-gray-50/50 p-6 rounded-2xl border border-gray-100">
           <div className="flex items-center justify-between mb-2">
             <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
               <ShieldAlert className="text-red-500 h-5 w-5" /> Active Deviations
             </h2>
             <span className="text-xs font-semibold text-gray-500 bg-gray-200 px-2.5 py-1 rounded-full">{mockAnomalies.length}</span>
           </div>

           <div className="flex-1 space-y-4">
             {mockAnomalies.map((anm) => (
               <div key={anm.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 transition-all hover:shadow-md hover:border-gray-300">
                 <div className="flex justify-between items-start mb-3">
                   <div className="flex items-center gap-2">
                     {anm.severity === 'High' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-800 border border-red-200">Critical</span>
                     ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">Warning</span>
                     )}
                     <span className="text-sm font-bold text-gray-900 border-l border-gray-200 pl-2 ml-1">{anm.id}</span>
                   </div>
                   <span className="text-xs text-gray-500 font-medium">{anm.time}</span>
                 </div>
                 
                 <div className="text-sm font-semibold text-gray-800 mb-1">Parameter: <span className="font-normal text-gray-600">{anm.parameter}</span></div>
                 <p className="text-sm text-gray-600 line-clamp-2 leading-relaxed">{anm.description}</p>
               </div>
             ))}
           </div>
        </div>
      </div>
    </div>
  );
}
