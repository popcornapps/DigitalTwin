import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { mockTrendData, mockParameters } from '../lib/mockData';

export default function ProcessMonitoring() {
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Live Process Monitoring</h1>
          <p className="text-sm text-gray-500">Real-time parameters and control charting</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {mockParameters.map((param) => (
          <div key={param.name} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
            <div className="flex justify-between items-start mb-4">
              <span className="text-sm font-medium text-gray-500">{param.name}</span>
              <span className={`w-3 h-3 rounded-full ${param.status === 'normal' ? 'bg-green-500' : param.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'}`}></span>
            </div>
            <div className="text-2xl font-bold text-gray-900 mb-1">{param.current} {param.unit}</div>
            <div className="text-sm text-gray-500 flex justify-between">
              <span>Golden: {param.golden}</span>
              <span className="text-blue-600 font-medium">StdDev: {param.stdDev}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Pressure vs Temperature Correlation</h2>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={mockTrendData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} />
              <YAxis yAxisId="left" domain={['auto', 'auto']} stroke="#3b82f6" fontSize={12} orientation="left" />
              <YAxis yAxisId="right" domain={['auto', 'auto']} stroke="#f59e0b" fontSize={12} orientation="right" />
              <Tooltip />
              <Area yAxisId="left" type="monotone" dataKey="temp" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} name="Temperature" />
              <Area yAxisId="right" type="step" dataKey="pressure" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} name="Pressure" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
