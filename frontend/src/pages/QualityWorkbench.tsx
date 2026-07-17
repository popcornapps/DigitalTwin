import { mockQualityMetrics } from '../lib/mockData';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function QualityWorkbench() {
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quality Workbench</h1>
          <p className="text-sm text-gray-500">Live CQAs (Critical Quality Attributes)</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {mockQualityMetrics.map((qm) => (
          <div key={qm.name} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
             <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-gray-500">{qm.name}</span>
                {qm.status === 'pass' ? <CheckCircle2 className="text-green-500" size={20} /> : <AlertCircle className="text-yellow-500" size={20} />}
             </div>
             <div className="text-2xl font-bold text-gray-900">{qm.value}</div>
             <div className="text-sm text-gray-500 mt-1">Target: {qm.target}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Feature Importance: Yield Correlation</h2>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
             <BarChart data={[
                { feature: 'Agitator Speed', importance: 85 },
                { feature: 'Temperature', importance: 72 },
                { feature: 'Pressure', importance: 41 },
                { feature: 'Humidity', importance: 20 },
             ]} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e5e7eb" />
                <XAxis type="number" domain={[0, 100]} hide />
                <YAxis dataKey="feature" type="category" width={100} axisLine={false} tickLine={false} tick={{fill: '#4b5563', fontSize: 12}} />
                <Tooltip cursor={{fill: '#f9fafb'}} />
                <Bar dataKey="importance" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={32} />
             </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
