import { mockAnomalies, mockTrendData } from '../lib/mockData';
import { ShieldAlert, AlertTriangle, AlertCircle } from 'lucide-react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Data mapping for scatter chart anomaly clustering
const scatterData = mockTrendData.map((d, i) => ({
  x: i,
  y: d.pressure,
  z: Math.abs(d.pressure - d.goldenPressure) * 10
}));

export default function AnomalyIntelligence() {
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Anomaly Intelligence</h1>
          <p className="text-sm text-gray-500">Multivariate statistical deviation tracking</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-700 rounded-md border border-red-100">
           <ShieldAlert size={20} />
           <span className="font-semibold">{mockAnomalies.length} Active Deviations</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
           <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Pressure Variance Clustering</h2>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis type="number" dataKey="x" name="Time Slot" hide />
                    <YAxis type="number" dataKey="y" name="Pressure" stroke="#6b7280" fontSize={12} domain={['auto', 'auto']} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                    <Scatter name="Variance Map" data={scatterData} fill="#ef4444" />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
           </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-0 overflow-hidden flex flex-col">
           <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-gray-800">Deviation Log</h2>
           </div>
           <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
             {mockAnomalies.map((anm) => (
                <div key={anm.id} className="p-6 hover:bg-gray-50">
                   <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        {anm.severity === 'High' ? <AlertCircle className="text-red-500" size={18} /> : <AlertTriangle className="text-yellow-500" size={18} />}
                        <span className="font-bold text-gray-900">{anm.id}</span>
                      </div>
                      <span className="text-xs text-gray-500 font-medium">{anm.time}</span>
                   </div>
                   <div className="text-sm font-semibold text-gray-700 mb-1">Parameter: {anm.parameter}</div>
                   <p className="text-sm text-gray-600">{anm.description}</p>
                </div>
             ))}
           </div>
        </div>
      </div>
    </div>
  );
}
