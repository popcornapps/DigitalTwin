import { Activity, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { mockKPIs, mockPlantData, mockTrendData } from '../lib/mockData';

export default function Dashboard() {
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Executive Dashboard</h1>
          <p className="text-sm text-gray-500">Plant Performance and Batch Overview</p>
        </div>
        <div className="text-right">
          <div className="text-sm text-gray-500">Current Batch</div>
          <div className="text-lg font-semibold text-blue-600">{mockPlantData.currentBatch}</div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Plant Performance" value={`${mockKPIs.plantPerformance}%`} icon={<Activity />} color="text-green-600" />
        <KPICard title="OEE" value={`${mockKPIs.oee}%`} icon={<CheckCircle />} color="text-blue-600" />
        <KPICard title="Quality Score" value={`${mockKPIs.qualityScore}%`} icon={<CheckCircle />} color="text-teal-600" />
        <KPICard title="Active Alerts" value={mockKPIs.criticalAlerts.toString()} icon={<AlertTriangle />} color="text-red-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Chart */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 shadow-sm p-5">
          <h2 className="text-lg font-semibold mb-4 text-gray-800">Process Temperature Trend vs Golden Batch</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mockTrendData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis domain={['auto', 'auto']} stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip />
                <Area type="monotone" dataKey="temp" name="Current Batch" stroke="#3b82f6" fillOpacity={0.1} fill="#3b82f6" />
                <Area type="monotone" dataKey="goldenTemp" name="Golden Batch" stroke="#10b981" fillOpacity={0.1} fill="#10b981" strokeDasharray="4 4" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Batch Status */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 flex flex-col">
          <h2 className="text-lg font-semibold mb-4 text-gray-800">Current Batch Status</h2>
          <div className="flex-1 flex flex-col justify-center space-y-6">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-500">Stage</span>
                <span className="font-medium text-gray-900">{mockPlantData.stage}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${mockPlantData.progress}%` }}></div>
              </div>
              <div className="text-right text-xs text-gray-500 mt-1">{mockPlantData.progress}% Complete</div>
            </div>
            
            <div className="flex items-center gap-3 p-3 bg-blue-50 text-blue-800 rounded-md">
              <Clock size={20} />
              <div className="text-sm">
                <div className="font-semibold">Predicted Completion</div>
                <div>{mockPlantData.predictedCompletion}</div>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <div className="text-sm text-gray-500 mb-2">Golden Batch Similarity</div>
              <div className="text-3xl font-bold text-teal-600">{mockKPIs.goldenBatchSimilarity}%</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KPICard({ title, value, icon, color }: { title: string, value: string, icon: React.ReactNode, color: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 flex items-center justify-between">
      <div>
        <p className="text-sm text-gray-500 font-medium">{title}</p>
        <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      </div>
      <div className={`p-3 bg-gray-50 rounded-full ${color}`}>
        {icon}
      </div>
    </div>
  );
}
