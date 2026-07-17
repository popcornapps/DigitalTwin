import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import { mockKPIs, mockPlantData } from '../lib/mockData';
import { Award, Zap, CheckCircle, AlertTriangle } from 'lucide-react';

const mockRadarData = [
  { subject: 'Yield', current: 98, golden: 99, fullMark: 100 },
  { subject: 'Purity', current: 97, golden: 99, fullMark: 100 },
  { subject: 'Density', current: 99, golden: 99, fullMark: 100 },
  { subject: 'Cycle Time', current: 85, golden: 98, fullMark: 100 },
  { subject: 'Energy', current: 92, golden: 95, fullMark: 100 },
  { subject: 'Anomalies', current: 90, golden: 100, fullMark: 100 },
];

export default function GoldenBatch() {
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Golden Batch Assessment</h1>
          <p className="text-sm text-gray-500">Comparing {mockPlantData.currentBatch} against {mockPlantData.goldenBatch}</p>
        </div>
        <div className="flex gap-4 items-center">
          <div className="text-right">
             <div className="text-sm font-medium text-gray-500">Similarity Score</div>
             <div className="text-2xl font-bold text-teal-600">{mockKPIs.goldenBatchSimilarity}%</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 flex flex-col">
          <h2 className="text-lg font-semibold text-gray-800 mb-6 flex items-center"><Award className="mr-2 text-yellow-500" /> Multi-Factor Capabilities</h2>
          <div className="flex-1 min-h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="80%" data={mockRadarData}>
                <PolarGrid stroke="#e5e7eb" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: '#4b5563', fontSize: 12 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} />
                <Radar name="Current Batch" dataKey="current" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.4} />
                <Radar name="Golden Batch" dataKey="golden" stroke="#10b981" fill="#10b981" fillOpacity={0.4} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-6 mt-4 text-sm text-gray-600">
             <div className="flex items-center gap-2"><div className="w-3 h-3 bg-blue-500 opacity-60 rounded-full"></div> Current</div>
             <div className="flex items-center gap-2"><div className="w-3 h-3 bg-teal-500 opacity-60 rounded-full"></div> Golden Context</div>
          </div>
        </div>
        
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 flex items-start gap-4">
             <div className="p-3 bg-yellow-50 rounded-full text-yellow-600"><AlertTriangle size={24} /></div>
             <div>
                <h3 className="font-semibold text-gray-900 text-lg">Cycle Time Deviation</h3>
                <p className="text-gray-600 text-sm mt-1">The current batch is tracking 12% slower than the Golden Batch due to a compounding variance in granulator mixing duration.</p>
             </div>
          </div>
          
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 flex items-start gap-4">
             <div className="p-3 bg-green-50 rounded-full text-green-600"><CheckCircle size={24} /></div>
             <div>
                <h3 className="font-semibold text-gray-900 text-lg">Yield Superiority</h3>
                <p className="text-gray-600 text-sm mt-1">Material efficiency is matching the Golden Profile flawlessly. Forecasted yield remains strictly within control bounds.</p>
             </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 flex items-start gap-4">
             <div className="p-3 bg-blue-50 rounded-full text-blue-600"><Zap size={24} /></div>
             <div>
                <h3 className="font-semibold text-gray-900 text-lg">AI Recommendation</h3>
                <p className="text-gray-600 text-sm mt-1">To recover the cycle time delay without impacting product density, consider a 3% increase in air flow rate during the fluid bed drying stage.</p>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}

