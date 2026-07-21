import {
  Award,
  ShieldCheck,
  Activity,
  FileText,
  Calendar,
  Clock,
  Flame,
  Check
} from 'lucide-react';
import { useState } from 'react';
import { useFilter } from '../context/FilterContext';
import { KPIInfoModal } from '../components/KPIInfoModal';
import { getKPIDefinition } from '../lib/kpiDefinitions';

export default function GoldenBatch() {
  const { selectedPlant, selectedProduct } = useFilter();
  const [activeKPIId, setActiveKPIId] = useState<string | null>(null);

  // 1. Generate Golden Batch metadata statically based on Plant & Product
  const getGoldenProfile = (plant: string, product: string) => {
    const plCode = plant.substring(0, 3).toUpperCase();
    const pCode = product.substring(0, 3).toUpperCase();
    
    let duration = "12.75 hrs";
    let yieldVal = "99.2%";
    let quality = "99.5%";
    let performance = "98.9%";
    let date = "2026-06-12";

    if (product.includes('Amoxicillin')) {
      duration = "14.25 hrs";
      yieldVal = "98.6%";
      quality = "99.1%";
      performance = "98.2%";
      date = "2026-06-08";
    } else if (product.includes('Ibuprofen')) {
      duration = "10.5 hrs";
      yieldVal = "99.0%";
      quality = "99.3%";
      performance = "98.7%";
      date = "2026-06-20";
    }

    return {
      id: `${plCode}-${pCode}-GOLDEN`,
      productName: product,
      plantName: plant,
      date,
      duration,
      yield: yieldVal,
      qualityScore: quality,
      performanceScore: performance,
    };
  };

  const goldenProfile = getGoldenProfile(selectedPlant, selectedProduct);

  // 2. Checklist details explaining why this batch was selected
  const selectionReasons = [
    { title: 'Highest Yield', desc: `Overall yield reached ${goldenProfile.yield}, minimizing material waste and raw ingredient scrap to near-zero levels.` },
    { title: 'Highest Quality Score', desc: `Critical quality attributes averaged a consistent ${goldenProfile.qualityScore} purity with zero Out-of-Specification (OOS) occurrences.` },
    { title: 'Lowest Cycle Time', desc: `Granulation and final drying steps completed in ${goldenProfile.duration}, representing optimal process throughput efficiency.` },
    { title: 'Lowest Energy Consumption', desc: 'Process energy requirement was 12% lower than average runs due to optimized temperature ramps.' },
    { title: 'Stable Process Parameters', desc: 'Critical variables (inlet temperature, feed pressures, speeds) stayed within ±1% of nominal targets.' },
    { title: 'Zero Critical Deviations', desc: 'No system alarms, critical anomalies, or safety violations were triggered during execution.' },
    { title: 'Passed All Quality Tests', desc: 'Full compliance across all target granule sizes, dissolution profiles, and assay stability specifications.' }
  ];

  // 3. Optimal values used in the golden batch
  const getOptimalParameters = (product: string) => {
    if (product.includes('Amoxicillin')) {
      return [
        { name: 'Temperature', value: '58.0 °C', range: '56.0 - 60.0 °C', importance: 'Critical' },
        { name: 'Pressure', value: '1.5 bar', range: '1.4 - 1.6 bar', importance: 'Critical' },
        { name: 'Mixing Time', value: '30.0 min', range: '28.0 - 32.0 min', importance: 'Standard' },
        { name: 'Drying Time', value: '50.0 min', range: '48.0 - 52.0 min', importance: 'Standard' },
        { name: 'Flow Rate', value: '55.0 L/min', range: '50.0 - 60.0 L/min', importance: 'Standard' },
        { name: 'Agitator RPM', value: '25 RPM', range: '23 - 27 RPM', importance: 'Critical' },
        { name: 'Humidity', value: '35.0 %', range: '30.0 - 40.0 %', importance: 'Important' }
      ];
    }
    if (product.includes('Ibuprofen')) {
      return [
        { name: 'Temperature', value: '70.2 °C', range: '68.0 - 72.0 °C', importance: 'Critical' },
        { name: 'Pressure', value: '1.0 bar', range: '0.9 - 1.1 bar', importance: 'Critical' },
        { name: 'Mixing Time', value: '20.0 min', range: '19.0 - 21.0 min', importance: 'Standard' },
        { name: 'Drying Time', value: '40.0 min', range: '38.0 - 42.0 min', importance: 'Standard' },
        { name: 'Flow Rate', value: '42.0 L/min', range: '38.0 - 45.0 L/min', importance: 'Standard' },
        { name: 'Agitator RPM', value: '20 RPM', range: '18 - 22 RPM', importance: 'Critical' },
        { name: 'Humidity', value: '45.0 %', range: '40.0 - 50.0 %', importance: 'Important' }
      ];
    }
    // Default Paracetamol
    return [
      { name: 'Temperature', value: '65.5 °C', range: '63.0 - 67.0 °C', importance: 'Critical' },
      { name: 'Pressure', value: '1.2 bar', range: '1.1 - 1.3 bar', importance: 'Critical' },
      { name: 'Mixing Time', value: '25.0 min', range: '24.0 - 26.0 min', importance: 'Standard' },
      { name: 'Drying Time', value: '45.0 min', range: '42.0 - 47.0 min', importance: 'Standard' },
      { name: 'Flow Rate', value: '48.5 L/min', range: '45.0 - 52.0 L/min', importance: 'Standard' },
      { name: 'Agitator RPM', value: '22 RPM', range: '20 - 24 RPM', importance: 'Critical' },
      { name: 'Humidity', value: '40.0 %', range: '37.0 - 43.0 %', importance: 'Important' }
    ];
  };

  const optimalParams = getOptimalParameters(selectedProduct);

  // 4. Golden Batch Performance Summary (6 KPIs)
  const getPerformanceKPIs = (product: string) => {
    if (product.includes('Amoxicillin')) {
      return [
        { label: 'Yield', value: '98.6%', icon: <Activity className="h-5 w-5 text-emerald-600" />, color: 'bg-emerald-50' },
        { label: 'Quality Score', value: '99.1%', icon: <ShieldCheck className="h-5 w-5 text-rose-600" />, color: 'bg-rose-50' },
        { label: 'Cycle Time', value: '14.25 hrs', icon: <Clock className="h-5 w-5 text-blue-600" />, color: 'bg-blue-50' },
        { label: 'Energy Consumption', value: '280 kWh', icon: <Flame className="h-5 w-5 text-orange-600" />, color: 'bg-orange-50' },
        { label: 'Process Stability', value: '97.9%', icon: <Award className="h-5 w-5 text-teal-600" />, color: 'bg-teal-50' },
        { label: 'OEE', value: '95.8%', icon: <Activity className="h-5 w-5 text-indigo-600" />, color: 'bg-indigo-50' }
      ];
    }
    if (product.includes('Ibuprofen')) {
      return [
        { label: 'Yield', value: '99.0%', icon: <Activity className="h-5 w-5 text-emerald-600" />, color: 'bg-emerald-50' },
        { label: 'Quality Score', value: '99.3%', icon: <ShieldCheck className="h-5 w-5 text-rose-600" />, color: 'bg-rose-50' },
        { label: 'Cycle Time', value: '10.5 hrs', icon: <Clock className="h-5 w-5 text-blue-600" />, color: 'bg-blue-50' },
        { label: 'Energy Consumption', value: '210 kWh', icon: <Flame className="h-5 w-5 text-orange-600" />, color: 'bg-orange-50' },
        { label: 'Process Stability', value: '98.8%', icon: <Award className="h-5 w-5 text-teal-600" />, color: 'bg-teal-50' },
        { label: 'OEE', value: '97.2%', icon: <Activity className="h-5 w-5 text-indigo-600" />, color: 'bg-indigo-50' }
      ];
    }
    // Default Paracetamol
    return [
      { label: 'Yield', value: '99.2%', icon: <Activity className="h-5 w-5 text-emerald-600" />, color: 'bg-emerald-50' },
      { label: 'Quality Score', value: '99.5%', icon: <ShieldCheck className="h-5 w-5 text-rose-600" />, color: 'bg-rose-50' },
      { label: 'Cycle Time', value: '12.75 hrs', icon: <Clock className="h-5 w-5 text-blue-600" />, color: 'bg-blue-50' },
      { label: 'Energy Consumption', value: '240 kWh', icon: <Flame className="h-5 w-5 text-orange-600" />, color: 'bg-orange-50' },
      { label: 'Process Stability', value: '98.4%', icon: <Award className="h-5 w-5 text-teal-600" />, color: 'bg-teal-50' },
      { label: 'OEE', value: '96.5%', icon: <Activity className="h-5 w-5 text-indigo-600" />, color: 'bg-indigo-50' }
    ];
  };

  const performanceKPIs = getPerformanceKPIs(selectedProduct);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex justify-between items-end border-b border-gray-200 pb-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Award className="h-6 w-6 text-teal-600" /> Golden Batch Reference Profile
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Ideal manufacturing benchmark specifications for {selectedProduct} at {selectedPlant}
          </p>
        </div>
        <div className="flex gap-4 items-center">
          <div className="text-right">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Active Golden Batch</div>
            <div className="text-sm font-bold text-slate-800 font-mono">{goldenProfile.id}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Section: Golden Batch Reference Summary */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 transition-shadow hover:shadow-md">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 text-lg">Golden Batch Reference Summary</h3>
                <p className="text-xs text-gray-500">Record metadata and high-level benchmark yields</p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-2">
              <div>
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Golden Batch ID</span>
                <span className="text-sm font-bold text-slate-800 font-mono mt-0.5 block">{goldenProfile.id}</span>
              </div>
              <div>
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Plant Facility</span>
                <span className="text-sm font-semibold text-slate-700 mt-0.5 block">{goldenProfile.plantName}</span>
              </div>
              <div>
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Product Code</span>
                <span className="text-sm font-semibold text-slate-700 mt-0.5 block">{goldenProfile.productName}</span>
              </div>
              <div>
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Manufacturing Date</span>
                <span className="text-sm font-semibold text-slate-700 mt-0.5 block flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-gray-400" /> {goldenProfile.date}
                </span>
              </div>
              <div>
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Batch Duration</span>
                <span className="text-sm font-semibold text-slate-700 mt-0.5 block flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-gray-400" /> {goldenProfile.duration}
                </span>
              </div>
              <div>
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Overall Performance Score</span>
                <span className="text-sm font-bold text-teal-600 mt-0.5 block">{goldenProfile.performanceScore}</span>
              </div>
            </div>
          </div>

          {/* Section: Optimal Process Parameters */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 transition-shadow hover:shadow-md">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 text-lg">Optimal Process Parameters</h3>
                <p className="text-xs text-gray-500">Ideal operating target values and ranges used in the Golden Batch</p>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    <th className="py-2.5">Parameter Name</th>
                    <th className="py-2.5 text-right">Optimal Value</th>
                    <th className="py-2.5 text-right">Operating Range</th>
                    <th className="py-2.5 text-right">Classification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 text-gray-700">
                  {optimalParams.map((param, index) => (
                    <tr key={index} className="hover:bg-slate-50/50">
                      <td className="py-3 font-medium text-slate-800">{param.name}</td>
                      <td className="py-3 text-right font-bold text-slate-900">{param.value}</td>
                      <td className="py-3 text-right text-gray-450 text-gray-500 font-mono text-xs">{param.range}</td>
                      <td className="py-3 text-right">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                          param.importance === 'Critical' 
                            ? 'bg-rose-50 text-rose-700 border border-rose-100' 
                            : param.importance === 'Important'
                            ? 'bg-amber-50 text-amber-700 border border-amber-100'
                            : 'bg-slate-50 text-slate-600 border border-slate-100'
                        }`}>
                          {param.importance}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* Right Column (5 cols) */}
        <div className="lg:col-span-5 space-y-6">

          {/* Section: Golden Batch Performance KPIs */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 transition-shadow hover:shadow-md">
            <h3 className="font-semibold text-gray-900 text-lg mb-4 flex items-center gap-2">
              <Activity className="h-5 w-5 text-indigo-500" /> Golden Batch Performance KPIs
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {performanceKPIs.map((kpi, idx) => {
                const kpiIdMap: Record<string, string> = {
                  'Yield': 'yield',
                  'Quality Score': 'qualityScore',
                  'Cycle Time': 'cycleTime',
                  'Energy Consumption': 'sec',
                  'Process Stability': 'processStability',
                  'OEE': 'oee'
                };
                const kpiId = kpiIdMap[kpi.label];

                return (
                  <button
                    key={idx}
                    onClick={() => setActiveKPIId(kpiId)}
                    className="text-left bg-slate-50/50 rounded-xl p-4 border border-slate-100 flex flex-col justify-between hover:bg-white hover:shadow-sm transition-all cursor-pointer hover:ring-2 hover:ring-indigo-100"
                  >
                    <span className="text-xs font-semibold text-gray-500 tracking-wide uppercase">{kpi.label}</span>
                    <div className="flex items-center justify-between mt-3">
                      <div className={`p-2 rounded-lg ${kpi.color}`}>
                        {kpi.icon}
                      </div>
                      <span className="text-lg font-bold text-gray-955 text-gray-900">{kpi.value}</span>
                    </div>
                    <span className="text-[10px] font-semibold text-indigo-400 mt-2">Click for details</span>
                  </button>
                );
              })}
            </div>
          </div>
          
          {/* Section: Why This Batch Was Selected */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 transition-shadow hover:shadow-md">
            <h3 className="font-semibold text-gray-900 text-lg mb-4 flex items-center">
              <ShieldCheck className="h-5 w-5 mr-2 text-emerald-600" />
              Why This Batch Was Selected
            </h3>
            <div className="space-y-4">
              {selectionReasons.map((item, index) => (
                <div key={index} className="flex items-start gap-3">
                  <div className="p-1 bg-emerald-50 rounded-full text-emerald-600 mt-0.5 flex-shrink-0">
                    <Check className="h-3.5 w-3.5 stroke-[3]" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-gray-800">{item.title}</h4>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* KPI Education Modal */}
      {activeKPIId && getKPIDefinition(activeKPIId) && (
        <KPIInfoModal
          kpiDefinition={getKPIDefinition(activeKPIId)!}
          currentValue={
            performanceKPIs.find(k => {
              const kpiIdMap: Record<string, string> = {
                'Yield': 'yield', 'Quality Score': 'qualityScore',
                'Cycle Time': 'cycleTime', 'Energy Consumption': 'sec',
                'Process Stability': 'processStability'
              };
              return kpiIdMap[k.label] === activeKPIId;
            })?.value
          }
          onClose={() => setActiveKPIId(null)}
        />
      )}

    </div>
  );
}
