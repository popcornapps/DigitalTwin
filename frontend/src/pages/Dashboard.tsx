import React from 'react';
import { 
  Activity, CheckCircle, AlertTriangle, Package, BarChart3,
  TrendingUp, TrendingDown, Zap
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { getMockKPIs } from '../lib/mockData';
import { useFilter } from '../context/FilterContext';

export default function Dashboard() {
  const { selectedPlant, selectedProduct } = useFilter();

  const mockKPIs = getMockKPIs(selectedPlant, selectedProduct);

  // Mock data for Plant Performance Trend (24 hours)
  const performanceTrend = [
    { time: '00:00', current: mockKPIs.plantPerformance - 6, best: 95 },
    { time: '04:00', current: mockKPIs.plantPerformance - 2, best: 96 },
    { time: '08:00', current: mockKPIs.plantPerformance + 1, best: 96 },
    { time: '12:00', current: mockKPIs.plantPerformance - 3, best: 97 },
    { time: '16:00', current: mockKPIs.plantPerformance, best: 96 },
    { time: '20:00', current: mockKPIs.plantPerformance + 2, best: 98 },
    { time: '24:00', current: mockKPIs.plantPerformance + 1, best: 97 },
  ];

  const aiInsights = [
    `Plant performance remains ${mockKPIs.plantPerformance > 90 ? 'above' : 'below'} baseline target.`,
    "Production schedule is progressing as planned with minor delays.",
    `OEE has ${mockKPIs.oee > 90 ? 'improved' : 'decreased'} compared to yesterday.`,
    "No major quality or safety risks detected for the active shift."
  ];

  const recentAlerts = [
    { id: 1, severity: 'Warning', equipment: 'Boiler Sys-A', desc: 'Temperature slightly higher than expected.' },
    { id: 2, severity: 'Critical', equipment: 'Packaging Line 2', desc: 'Line temporarily stopped due to sensor fault.' },
    { id: 3, severity: 'Warning', equipment: 'Mixer Unit 4', desc: 'Vibration levels nearing upper control limit.' }
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{selectedPlant} Performance</h1>
          <p className="text-sm text-gray-500 mt-1">Product: {selectedProduct} | Overall Plant Health & Production Overview</p>
        </div>
      </div>

      {/* Section 1: KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <KPICard 
          title="Plant Performance" 
          value="94%" 
          trend="up" 
          trendValue="+1.2%" 
          desc="Overall plant health & efficiency" 
          icon={<Activity />} 
          color="text-emerald-600" 
          bg="bg-emerald-50" 
        />
        <KPICard 
          title="OEE" 
          value={`${mockKPIs.oee}%`} 
          trend="up" 
          trendValue="+0.8%" 
          desc="Overall equipment effectiveness" 
          icon={<BarChart3 />} 
          color="text-blue-600" 
          bg="bg-blue-50" 
        />
        <KPICard 
          title="Quality Score" 
          value={`${mockKPIs.qualityScore}%`} 
          trend="flat" 
          trendValue="0.0%" 
          desc="Today's production quality" 
          icon={<CheckCircle />} 
          color="text-teal-600" 
          bg="bg-teal-50" 
        />
        <KPICard 
          title="Production Status" 
          value="4 / 6" 
          trend="up" 
          trendValue="On Track" 
          desc="Running vs Completed Batches" 
          icon={<Package />} 
          color="text-indigo-600" 
          bg="bg-indigo-50" 
        />
        <KPICard 
          title="Active Alerts" 
          value="2" 
          trend="down" 
          trendValue="-3 issues" 
          desc="Current operational warnings" 
          icon={<AlertTriangle />} 
          color="text-amber-600" 
          bg="bg-amber-50" 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Section 2: Plant Performance Trend */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex flex-col">
          <div className="flex justify-between items-start mb-6">
            <h2 className="text-lg font-semibold text-gray-900">Plant Performance (24 Hours)</h2>
            <div className="flex gap-4 text-sm bg-gray-50 border border-gray-100 rounded-lg p-3">
               <div>
                 <div className="text-gray-500 text-xs">Today's Average Performance</div>
                 <div className="font-bold text-gray-900">93.5%</div>
               </div>
               <div className="w-px bg-gray-200"></div>
               <div>
                 <div className="text-gray-500 text-xs">Best Historical Day Performance</div>
                 <div className="font-bold text-yellow-600">96.2%</div>
               </div>
               <div className="w-px bg-gray-200"></div>
               <div>
                 <div className="text-gray-500 text-xs">Performance Gap</div>
                 <div className="font-bold text-amber-600">-2.7%</div>
               </div>
            </div>
          </div>
          
          <div className="h-72 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={performanceTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis domain={['dataMin - 2', 100]} stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `${val}%`} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }}/>
                <Line type="monotone" dataKey="current" name="Current Performance" stroke="#3b82f6" strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="best" name="Best Historical Performance" stroke="#eab308" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          {/* Section 3: Production Summary */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-lg font-semibold mb-4 text-gray-900 flex items-center gap-2">
              <Package className="text-indigo-500 h-5 w-5" /> Production Summary
            </h2>
            <div className="grid grid-cols-2 gap-y-4 gap-x-2 text-sm">
               <div>
                 <div className="text-gray-500">Running Batches</div>
                 <div className="font-bold text-gray-900 text-lg">2</div>
               </div>
               <div>
                 <div className="text-gray-500">Completed Batches</div>
                 <div className="font-bold text-gray-900 text-lg">4</div>
               </div>
               <div>
                 <div className="text-gray-500">Planned Batches</div>
                 <div className="font-bold text-gray-900 text-lg">8</div>
               </div>
               <div>
                 <div className="text-gray-500">Current Shift</div>
                 <div className="font-bold text-gray-900 text-lg">Shift 2 (Day)</div>
               </div>
            </div>
          </div>

          {/* Section 4: AI Plant Summary */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex-1">
            <h2 className="text-lg font-semibold mb-4 text-gray-900 flex items-center gap-2">
              <Zap className="text-amber-500 h-5 w-5" /> AI Plant Insights
            </h2>
            <ul className="space-y-3">
              {aiInsights.map((insight, idx) => (
                <li key={idx} className="flex flex-col">
                  <div className="flex items-start">
                    <span className="text-indigo-500 mr-2 mt-0.5 font-bold">•</span>
                    <span className="text-sm text-gray-700 leading-snug">{insight}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Section 5: Recent Alerts */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
         <h2 className="text-lg font-semibold mb-4 text-gray-900 flex items-center gap-2">
           <AlertTriangle className="text-red-500 h-5 w-5" /> Recent Alerts
         </h2>
         <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
           {recentAlerts.map(alert => (
             <div key={alert.id} className="p-4 rounded-lg border border-gray-100 bg-gray-50 hover:bg-white hover:shadow-sm transition-all">
                <div className="flex items-center gap-2 mb-2">
                   {alert.severity === 'Critical' ? (
                       <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-800">Critical</span>
                   ) : (
                       <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800">Warning</span>
                   )}
                   <span className="text-sm font-bold text-gray-800">{alert.equipment}</span>
                </div>
                <p className="text-sm text-gray-600 line-clamp-2">{alert.desc}</p>
             </div>
           ))}
         </div>
      </div>
    </div>
  );
}

function KPICard({ 
  title, value, trend, trendValue, desc, icon, color, bg 
}: { 
  title: string, value: string, trend: 'up' | 'down' | 'flat', trendValue: string, desc: string, icon: React.ReactNode, color: string, bg: string 
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col justify-between">
      <div className="flex justify-between items-start mb-2">
        <p className="text-sm text-gray-500 font-semibold">{title}</p>
        <div className={`p-2 rounded-lg ${bg} ${color}`}>
          {React.cloneElement(icon as React.ReactElement, { size: 18 })}
        </div>
      </div>
      <div>
        <div className="flex items-end gap-2 mb-1">
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          <div className={`flex items-center text-xs font-medium mb-1 ${trend === 'up' && trendValue.includes('+') ? 'text-emerald-600' : trend === 'down' ? 'text-emerald-600' : 'text-gray-500'}`}>
             {trend === 'up' && trendValue.includes('+') && <TrendingUp size={12} className="mr-1" />}
             {trend === 'down' && trendValue.includes('-') && <TrendingDown size={12} className="mr-1" />}
             <span>{trendValue}</span>
          </div>
        </div>
        <p className="text-xs text-gray-400">{desc}</p>
      </div>
    </div>
  );
}
