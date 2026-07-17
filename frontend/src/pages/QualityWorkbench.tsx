import { useMemo } from 'react';
import { CheckCircle2, AlertCircle, XCircle, Award, ShieldAlert, FileText } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useFilter } from '../context/FilterContext';

interface CQA {
  name: string;
  value: string;
  target: string;
  status: 'pass' | 'warning' | 'fail';
}

export default function QualityWorkbench() {
  const { selectedBatch, selectedPlant, selectedProduct } = useFilter();

  // 1. Resolve batch code (fallback to Hyderabad / Paracetamol run -018 if batch is 'All Batches')
  const batchCode = selectedBatch === 'All Batches' 
    ? `${selectedPlant.substring(0, 3).toUpperCase()}-${selectedProduct.substring(0, 3).toUpperCase()}-018`
    : selectedBatch;

  // 2. Generate dynamic CQA metrics, risk profile, and recommendations matching simulated run states
  const qualityReport = useMemo(() => {
    const suffix = batchCode.substring(batchCode.length - 3);

    if (suffix === '018') {
      return {
        score: '97.4%',
        status: 'Requires Review',
        passedCount: '4 / 5',
        risk: 'Medium',
        riskColor: 'text-amber-600 bg-amber-50 border-amber-100',
        statusColor: 'text-amber-800 bg-amber-100 border-amber-250',
        cqas: [
          { name: 'Purity', value: '99.1%', target: '>99.0%', status: 'pass' },
          { name: 'Moisture', value: '2.3%', target: '<2.0%', status: 'warning' },
          { name: 'Dissolution', value: '96.2%', target: '>95.0%', status: 'pass' },
          { name: 'Hardness', value: '12.8 kp', target: '10.0 - 15.0 kp', status: 'pass' },
          { name: 'Content Uniformity', value: '98.4%', target: '95.0 - 105.0%', status: 'pass' }
        ] as CQA[],
        aiSummary: 'The selected batch has completed primary granulation. However, the final moisture level (2.3%) is hovering above the target ceiling of 2.0%. A drying stage verification is recommended before release.',
        releaseStatus: 'Requires Review',
        releaseExplanation: 'Moisture levels slightly exceed normal ceilings. Adjust final drying phase verification.'
      };
    }
    if (suffix === '017') {
      return {
        score: '99.4%',
        status: 'Approved',
        passedCount: '5 / 5',
        risk: 'Low',
        riskColor: 'text-emerald-700 bg-emerald-50 border-emerald-100',
        statusColor: 'text-emerald-800 bg-emerald-100 border-emerald-250',
        cqas: [
          { name: 'Purity', value: '99.6%', target: '>99.0%', status: 'pass' },
          { name: 'Moisture', value: '1.8%', target: '<2.0%', status: 'pass' },
          { name: 'Dissolution', value: '98.5%', target: '>95.0%', status: 'pass' },
          { name: 'Hardness', value: '11.5 kp', target: '10.0 - 15.0 kp', status: 'pass' },
          { name: 'Content Uniformity', value: '101.2%', target: '95.0 - 105.0%', status: 'pass' }
        ] as CQA[],
        aiSummary: 'The selected batch satisfies all critical quality attributes. All assay purities, hardness levels, and tablet uniformities exceed control limits. The batch is suitable for immediate release.',
        releaseStatus: 'Approved for Release',
        releaseExplanation: 'Batch conforms to all compendial specs. Recommended for release.'
      };
    }
    if (suffix === '016') {
      return {
        score: '91.2%',
        status: 'Requires Review',
        passedCount: '1 / 5',
        risk: 'High',
        riskColor: 'text-rose-700 bg-rose-50 border-rose-100',
        statusColor: 'text-rose-805 bg-rose-100 border-rose-250',
        cqas: [
          { name: 'Purity', value: '98.8%', target: '>99.0%', status: 'fail' },
          { name: 'Moisture', value: '1.9%', target: '<2.0%', status: 'pass' },
          { name: 'Dissolution', value: '94.6%', target: '>95.0%', status: 'fail' },
          { name: 'Hardness', value: '9.2 kp', target: '10.0 - 15.0 kp', status: 'fail' },
          { name: 'Content Uniformity', value: '94.1%', target: '95.0 - 105.0%', status: 'fail' }
        ] as CQA[],
        aiSummary: 'Multiple Critical Quality Attributes (CQAs), including dissolution rates, tablet hardness, and content uniformity, have failed to meet target limits. Batch is NOT suitable for release.',
        releaseStatus: 'Requires Review',
        releaseExplanation: 'Critical failures in purity, dissolution, and tablet hardness prevent release.'
      };
    }
    // Default fallback '015'
    return {
      score: '99.8%',
      status: 'Approved',
      passedCount: '5 / 5',
      risk: 'Low',
      riskColor: 'text-emerald-700 bg-emerald-50 border-emerald-100',
      statusColor: 'text-emerald-805 bg-emerald-100 border-emerald-250',
      cqas: [
        { name: 'Purity', value: '99.8%', target: '>99.0%', status: 'pass' },
        { name: 'Moisture', value: '1.7%', target: '<2.0%', status: 'pass' },
        { name: 'Dissolution', value: '99.2%', target: '>95.0%', status: 'pass' },
        { name: 'Hardness', value: '13.2 kp', target: '10.0 - 15.0 kp', status: 'pass' },
        { name: 'Content Uniformity', value: '100.2%', target: '95.0 - 105.0%', status: 'pass' }
      ] as CQA[],
      aiSummary: 'Batch shows exceptional uniformity and purity indices. The parameter specifications closely match the reference Golden Batch. Released with excellent quality indicators.',
      releaseStatus: 'Approved for Release',
      releaseExplanation: 'Conforms strictly to the Golden Reference Recipe profile. Ready for release.'
    };
  }, [batchCode]);

  // Quality Drivers influence chart data
  const chartData = [
    { parameter: 'Drying Time', influence: 85 },
    { parameter: 'Temperature', influence: 72 },
    { parameter: 'Mixing Speed', influence: 62 },
    { parameter: 'Pressure', influence: 41 },
    { parameter: 'Humidity', influence: 18 }
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex justify-between items-end border-b border-gray-200 pb-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Award className="h-6 w-6 text-teal-600" /> Quality Workbench
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            CQA release compliance and quality metrics evaluation for {batchCode}
          </p>
        </div>
        <div className="text-right">
          <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Facility & Product</span>
          <span className="text-sm font-semibold text-slate-700 block">{selectedPlant} | {selectedProduct}</span>
        </div>
      </div>

      {/* Requirement 1: Overall Quality Summary section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Overall Quality Score', value: qualityReport.score, icon: Award, color: 'text-indigo-650 text-indigo-600 font-bold', bg: 'bg-indigo-50 border border-indigo-100' },
          { label: 'Batch Release Status', value: qualityReport.status, icon: FileText, color: qualityReport.status === 'Approved' ? 'text-emerald-700' : 'text-amber-700', bg: `border ${qualityReport.risk === 'Low' ? 'bg-emerald-50/50 border-emerald-100' : 'bg-amber-50/50 border-amber-100'}` },
          { label: 'CQAs Passed', value: qualityReport.passedCount, icon: CheckCircle2, color: 'text-teal-600', bg: 'bg-teal-50/50 border border-teal-100' },
          { label: 'Quality Risk Profile', value: `${qualityReport.risk} Risk`, icon: ShieldAlert, color: qualityReport.risk === 'Low' ? 'text-emerald-700' : qualityReport.risk === 'Medium' ? 'text-amber-700' : 'text-red-700', bg: `border ${qualityReport.riskColor}` }
        ].map((item, idx) => (
          <div key={idx} className={`bg-white rounded-xl p-5 shadow-sm transition-shadow hover:shadow-md flex items-center gap-4 ${item.bg}`}>
            <div className="p-3 bg-white rounded-lg border border-gray-150 shadow-sm text-gray-600">
              <item.icon size={22} className={item.color} />
            </div>
            <div>
              <span className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">{item.label}</span>
              <span className={`text-xl font-bold block mt-0.5 ${item.color}`}>{item.value}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Requirement 2: Critical Quality Attributes (CQAs) Card Grid */}
      <div className="space-y-4">
        <h3 className="text-base font-bold text-gray-800 uppercase tracking-wider pl-1">Critical Quality Attributes (CQAs)</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {qualityReport.cqas.map((qm) => (
            <div key={qm.name} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 transition-shadow hover:shadow-md flex flex-col justify-between">
              <div className="flex justify-between items-start mb-3">
                <span className="text-sm font-semibold text-gray-600">{qm.name}</span>
                {qm.status === 'pass' ? (
                  <CheckCircle2 size={18} className="text-emerald-500 fill-emerald-50/50" />
                ) : qm.status === 'warning' ? (
                  <AlertCircle size={18} className="text-amber-500 fill-amber-50/50" />
                ) : (
                  <XCircle size={18} className="text-red-500 fill-red-50/50" />
                )}
              </div>
              <div>
                <div className="text-2xl font-extrabold text-gray-900">{qm.value}</div>
                <div className="text-xs text-gray-400 font-medium mt-1">Target limit: {qm.target}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Charts & AI Release Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Requirement 3: Quality Drivers Vertical Chart Card */}
        <div className="lg:col-span-8 bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col transition-shadow hover:shadow-md">
          <div className="flex items-center gap-2.5 mb-4">
            <Activity className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-gray-905 text-gray-900 border-none">Quality Drivers</h2>
          </div>
          <p className="text-xs text-gray-500 mb-6 pl-0.5">
            Influence weighting showing which manufacturing parameters have the greatest correlation with final batch quality
          </p>
          <div className="h-72 w-full flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                <XAxis type="number" domain={[0, 100]} hide />
                <YAxis dataKey="parameter" type="category" width={110} axisLine={false} tickLine={false} tick={{fill: '#475569', fontSize: 12, fontWeight: 500}} />
                <Tooltip cursor={{fill: '#f8fafc'}} />
                <Bar dataKey="influence" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right Column: AI Summary & Release Recommendation Cards */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Requirement 4: AI Quality Summary */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 transition-shadow hover:shadow-md space-y-3 flex flex-col justify-between">
            <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
              <FileText className="text-indigo-605 text-indigo-600 h-5 w-5" />
              <h3 className="font-bold text-gray-900">AI Quality Summary</h3>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100">
              "{qualityReport.aiSummary}"
            </p>
          </div>

          {/* Requirement 5: Release Recommendation */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 transition-shadow hover:shadow-md space-y-3.5">
            <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
              <ShieldAlert className="text-teal-600 h-5 w-5" />
              <h3 className="font-bold text-gray-900">Release Recommendation</h3>
            </div>

            <div className={`p-4 rounded-xl border text-center ${
              qualityReport.releaseStatus === 'Approved for Release'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-amber-50 text-amber-800 border-amber-200'
            }`}>
              {qualityReport.releaseStatus === 'Approved for Release' ? (
                <div className="flex flex-col items-center gap-1.5">
                  <CheckCircle2 size={28} className="text-emerald-600 fill-emerald-50" />
                  <span className="text-md font-bold uppercase tracking-wider">Approved for Release</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1.5">
                  <AlertCircle size={28} className="text-amber-600 fill-amber-50" />
                  <span className="text-md font-bold uppercase tracking-wider">Requires Action / Review</span>
                </div>
              )}
            </div>

            <p className="text-xs text-gray-500 font-medium pl-1 text-center leading-relaxed">
              {qualityReport.releaseExplanation}
            </p>
          </div>

        </div>

      </div>
    </div>
  );
}

// Simple fallback icon wrapper
function Activity(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
