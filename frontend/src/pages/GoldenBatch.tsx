import { mockKPIs, mockPlantData } from '../lib/mockData';
import { Award, Zap, CheckCircle, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';

const comparisonData = [
  { name: 'Yield', current: 98, golden: 99, status: 'Within Target', isWarning: false },
  { name: 'Purity', current: 97, golden: 99, status: 'Within Target', isWarning: false },
  { name: 'Density', current: 99, golden: 99, status: 'Within Target', isWarning: false },
  { name: 'Cycle Time', current: 85, golden: 98, status: 'Deviation', isWarning: true },
  { name: 'Energy', current: 92, golden: 95, status: 'Acceptable', isWarning: false },
  { name: 'Process Stability', current: 90, golden: 96, status: 'Warning', isWarning: true },
];

export default function GoldenBatch() {
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end border-b border-gray-200 pb-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Golden Batch Assessment</h1>
          <p className="text-sm text-gray-500 mt-1">Comparing {mockPlantData.currentBatch} against {mockPlantData.goldenBatch}</p>
        </div>
        <div className="flex gap-4 items-center">
          <div className="text-right">
             <div className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-1">Similarity Score</div>
             <div className="text-3xl font-bold text-teal-600">{mockKPIs.goldenBatchSimilarity}%</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Side: Performance Comparison */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col">
          <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center">
            <Award className="mr-3 text-teal-600 h-6 w-6" /> Performance Comparison
          </h2>
          
          <div className="space-y-6 flex-1">
            {comparisonData.map((kpi, idx) => (
              <div key={idx} className="flex flex-col space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-semibold text-gray-700">{kpi.name}</span>
                  <div className={`flex items-center text-xs font-medium space-x-1 ${kpi.isWarning ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {kpi.isWarning ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}
                    <span>{kpi.status}</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-[60px_1fr_40px] items-center gap-3 text-xs">
                  <span className="text-gray-500 font-medium">Current</span>
                  <div className="w-full bg-gray-100 rounded-full h-2.5">
                    <div 
                      className={`h-2.5 rounded-full ${kpi.isWarning ? 'bg-amber-500' : 'bg-teal-600'}`} 
                      style={{ width: `${kpi.current}%` }}
                    ></div>
                  </div>
                  <span className="text-right font-semibold text-gray-700">{kpi.current}%</span>
                  
                  <span className="text-gray-500 font-medium">Golden</span>
                  <div className="w-full bg-gray-100 rounded-full h-2.5">
                    <div 
                      className="h-2.5 rounded-full bg-slate-300" 
                      style={{ width: `${kpi.golden}%` }}
                    ></div>
                  </div>
                  <span className="text-right font-semibold text-gray-700">{kpi.golden}%</span>
                </div>
                
                {idx !== comparisonData.length - 1 && <div className="border-b border-gray-100 pt-2"></div>}
              </div>
            ))}
          </div>
        </div>
        
        {/* Right Side Cards */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 transition-shadow hover:shadow-md">
             <div className="flex justify-between items-start mb-3">
               <div className="flex items-center gap-3">
                 <div className="p-2 bg-amber-50 rounded-lg text-amber-600"><AlertTriangle className="h-5 w-5" /></div>
                 <h3 className="font-semibold text-gray-900 text-lg">Cycle Time Deviation</h3>
               </div>
               <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                 High Impact
               </span>
             </div>
             <p className="text-gray-600 text-sm ml-12">The current batch is tracking 12% slower than the Golden Batch due to a compounding variance in granulator mixing duration.</p>
          </div>
          
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 transition-shadow hover:shadow-md">
             <div className="flex justify-between items-start mb-3">
               <div className="flex items-center gap-3">
                 <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600"><CheckCircle className="h-5 w-5" /></div>
                 <h3 className="font-semibold text-gray-900 text-lg">Yield Status</h3>
               </div>
               <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
                 Within Control Limits
               </span>
             </div>
             <p className="text-gray-600 text-sm ml-12">Material efficiency is matching the Golden Profile flawlessly. Forecasted yield remains strictly within control bounds.</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 transition-shadow hover:shadow-md">
             <div className="flex justify-between items-start mb-4">
               <div className="flex items-center gap-3">
                 <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600"><Zap className="h-5 w-5" /></div>
                 <h3 className="font-semibold text-gray-900 text-lg">AI Recommendation</h3>
               </div>
             </div>
             <div className="ml-12 space-y-4">
               <ul className="space-y-2.5 text-sm text-gray-600">
                 <li className="flex items-start">
                    <CheckCircle className="h-4 w-4 text-indigo-500 mr-2 mt-0.5 flex-shrink-0" />
                    <span>Increase drying airflow by 3%</span>
                 </li>
                 <li className="flex items-start">
                    <CheckCircle className="h-4 w-4 text-indigo-500 mr-2 mt-0.5 flex-shrink-0" />
                    <span>Reduce granulation mixing time slightly</span>
                 </li>
               </ul>
               <div className="bg-gray-50 rounded-lg p-3.5 border border-gray-100">
                 <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center">Expected Result</div>
                 <div className="flex items-center gap-6">
                   <div className="flex items-center text-sm font-medium text-emerald-600">
                     <span>Cycle Time</span>
                     <TrendingDown className="h-4 w-4 ml-1" />
                   </div>
                   <div className="flex items-center text-sm font-medium text-emerald-600">
                     <span>Similarity Score</span>
                     <TrendingUp className="h-4 w-4 ml-1" />
                   </div>
                 </div>
               </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}

