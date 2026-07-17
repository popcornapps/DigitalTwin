import { useState, useMemo } from 'react';
import { getMockAnomalies } from '../lib/mockData';
import { 
  ShieldAlert, 
  BrainCircuit, 
  AlertTriangle, 
  Settings, 
  CheckCircle, 
  Info,
  AlertCircle,
  FileText
} from 'lucide-react';
import { useFilter } from '../context/FilterContext';

interface Anomaly {
  id: string;
  parameter: string;
  severity: string;
  time: string;
  status: string;
  description: string;
  stage: string;
  riskLevel: 'Low' | 'Medium' | 'High';
  rootCause: string;
  contributingFactors: string[];
  qualityImpact: string;
  productionImpact: string;
  confidence: string;
  recommendations: string[];
  expectedOutcome: string;
}

export default function AnomalyIntelligence() {
  const { selectedBatch, selectedPlant, selectedProduct } = useFilter();

  // 1. Fetch raw mock anomalies (fallback to Hyderabad / Paracetamol run -018 if batch is 'All Batches')
  const rawBatchCode = selectedBatch === 'All Batches' 
    ? `${selectedPlant.substring(0, 3).toUpperCase()}-${selectedProduct.substring(0, 3).toUpperCase()}-018`
    : selectedBatch;
  
  const rawAnomalies = getMockAnomalies(rawBatchCode);

  // 2. Enrich anomalies with root cause, impacts, and recommendations suitable for investigation
  const enrichedAnomalies = useMemo((): Anomaly[] => {
    return rawAnomalies.map((anm, idx) => {
      const isFirst = idx === 0 || anm.parameter.toLowerCase().includes('flow');
      if (isFirst) {
        return {
          ...anm,
          stage: 'Drying & Solvent Recovery',
          riskLevel: 'High',
          rootCause: 'Primary dry-bleed exhaust damper actuator sticking due to thermal expansion variance (+4.5°C over control threshold).',
          contributingFactors: [
            'Inlet air filter blockage (differential pressure at upper control limit of 220 Pa)',
            'Sudden blower speed fluctuation (1800 to 1845 RPM) due to ambient power sag',
            'High relative ambient humidity (62%) in material feed preparation room'
          ],
          qualityImpact: 'Potential moisture level deviation in the final granule blend. Dissolution profile may drift if final drying runtime is not extended.',
          productionImpact: 'Expected batch drying cycletime extension of 22 minutes to maintain nominal granule density. No batch termination required.',
          confidence: '96%',
          recommendations: [
            'Reduce drying airflow by 3% to normalize static pressure',
            'Verify pressure sensor calibration on Dryer-03',
            'Inspect inlet air temperature controls for sensor drift',
            'Continue monitoring after drying parameters adjustment'
          ],
          expectedOutcome: 'Dryer pressure returns within control limits, final batch moisture quality risk is reduced, and process stability is restored.'
        };
      } else {
        return {
          ...anm,
          stage: 'Granulation Mixing',
          riskLevel: 'Medium',
          rootCause: 'Slight powder feed rate fluctuations from the micro-feeder screw conveyor due to bulk density variance.',
          contributingFactors: [
            'Raw material bulk density discrepancy (+2.4% moisture variance in incoming lot)',
            'Minor shear heating at fluid-bed granulator impellor shaft',
            'Sop load cell calibration drift on hopper weighing sensors'
          ],
          qualityImpact: 'Slight granule size distribution variation. Higher particle agglomeration rate in tablet press stage.',
          productionImpact: 'Increased risk of tablet weight variation during tableting. No immediate run stoppage required.',
          confidence: '92%',
          recommendations: [
            'Execute zero-point calibration on feed hopper weigh scales',
            'Inspect screw feeder conveyor for product buildup',
            'Maintain agitator drive shaft speed locked at 22 RPM',
            'Continue monitoring after feed adjustment'
          ],
          expectedOutcome: 'Material feed pressure stabilizes, granule size distribution remains within limits, and tablet quality is preserved.'
        };
      }
    });
  }, [rawAnomalies]);

  // 3. Selection state for active investigation subject
  const [selectedId, setSelectedId] = useState<string | null>(
    enrichedAnomalies.length > 0 ? enrichedAnomalies[0].id : null
  );

  // If selectedId is invalid due to filter changes, reset to the first one available
  const activeAnomaly = useMemo(() => {
    const found = enrichedAnomalies.find(a => a.id === selectedId);
    if (found) return found;
    if (enrichedAnomalies.length > 0) {
      return enrichedAnomalies[0];
    }
    return null;
  }, [enrichedAnomalies, selectedId]);

  // Sync state if active filter changes list
  useMemo(() => {
    if (enrichedAnomalies.length > 0) {
      const exists = enrichedAnomalies.some(a => a.id === selectedId);
      if (!exists) {
        setSelectedId(enrichedAnomalies[0].id);
      }
    } else {
      setSelectedId(null);
    }
  }, [enrichedAnomalies, selectedId]);

  // Derived KPI Summaries
  const kpis = useMemo(() => {
    const active = enrichedAnomalies.length;
    const critical = enrichedAnomalies.filter(a => a.severity === 'High' || a.riskLevel === 'High').length;
    const highestRisk = enrichedAnomalies.length > 0 ? enrichedAnomalies[0].parameter : 'None';
    const activeConf = activeAnomaly ? activeAnomaly.confidence : '96%';

    return {
      active,
      critical,
      highestRisk,
      activeConf
    };
  }, [enrichedAnomalies, activeAnomaly]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex justify-between items-end border-b border-gray-200 pb-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BrainCircuit className="h-6 w-6 text-indigo-600" /> AI Anomaly Incident Investigation
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Conducting root-cause diagnostics and impact assessments for {rawBatchCode} ({selectedProduct})
          </p>
        </div>
        <div className="text-right">
          <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Facility Location</span>
          <span className="text-sm font-semibold text-slate-700 block">{selectedPlant}</span>
        </div>
      </div>

      {/* Requirement 2: Top KPI Cards (Anomaly Analysis Focus) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Active Anomalies', value: kpis.active.toString(), icon: ShieldAlert, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Critical Anomalies', value: kpis.critical.toString(), icon: AlertCircle, color: 'text-red-650 text-red-600', bg: 'bg-red-50' },
          { label: 'Highest Risk Parameter', value: kpis.highestRisk, icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50' },
          { label: 'AI Investigation Confidence', value: kpis.activeConf, icon: BrainCircuit, color: 'text-indigo-650 text-indigo-600', bg: 'bg-indigo-50' },
        ].map((kpi, idx) => (
          <div key={idx} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 transition-all hover:shadow-md flex items-center gap-4">
            <div className={`p-3 rounded-lg ${kpi.bg} ${kpi.color}`}>
              <kpi.icon size={22} />
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-505 text-gray-500 uppercase tracking-wider">{kpi.label}</div>
              <div className="text-2xl font-bold text-gray-900 mt-0.5">{kpi.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Investigation Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Requirement 3: Active Deviations List (Left Column, span 4) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="flex items-center justify-between pl-1">
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <ShieldAlert className="text-amber-500 h-4.5 w-4.5" /> Incident Record Log
            </h2>
            <span className="text-xs font-bold text-gray-500 bg-gray-200 px-2.5 py-0.5 rounded-full">{enrichedAnomalies.length}</span>
          </div>

          <div className="space-y-3.5">
            {enrichedAnomalies.map((anm) => {
              const worksAsActive = activeAnomaly?.id === anm.id;
              const isCritical = anm.severity === 'High' || anm.riskLevel === 'High';
              return (
                <div 
                  key={anm.id} 
                  onClick={() => setSelectedId(anm.id)}
                  className={`bg-white rounded-xl shadow-sm border p-5 cursor-pointer transition-all hover:shadow-md hover:border-gray-400 ${
                    worksAsActive 
                      ? 'border-indigo-500 ring-2 ring-indigo-50' 
                      : 'border-gray-200'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2.5">
                    <span className="text-xs font-bold text-slate-500 font-mono select-all">{anm.id}</span>
                    <span className="text-xs text-gray-400">{anm.time}</span>
                  </div>

                  <div className="mb-2">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${
                      isCritical
                        ? 'bg-red-50 text-red-700 border border-red-100'
                        : 'bg-amber-50 text-amber-700 border border-amber-100'
                    }`}>
                      {isCritical ? 'Critical' : 'Warning'}
                    </span>
                    <span className="text-xs font-semibold text-slate-500 ml-2">Stage: {anm.stage}</span>
                  </div>

                  <div className="text-sm font-bold text-slate-800 mb-1">
                    Parameter: <span className="font-semibold text-indigo-600">{anm.parameter}</span>
                  </div>
                  <p className="text-xs text-gray-550 text-gray-500 leading-relaxed font-medium mt-1">
                    {anm.description}
                  </p>
                </div>
              );
            })}

            {enrichedAnomalies.length === 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center flex flex-col items-center justify-center">
                <Info className="h-8 w-8 text-gray-400 mb-2" />
                <span className="text-xs font-bold text-gray-650 text-gray-500">No Anomalies Found</span>
                <p className="text-xxs text-gray-400 mt-1 max-w-xs leading-normal">
                  This batch currently shows a healthy operational profile in this facility.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* AI Dossier & Actions (Right Column, span 8) */}
        <div className="lg:col-span-8 space-y-6">
          {activeAnomaly ? (
            <>
              {/* Requirement 4: Improved AI Root Cause Analysis */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 transition-shadow hover:shadow-md space-y-4">
                <div className="flex justify-between items-start border-b border-gray-150 border-gray-100 pb-3">
                  <div className="flex items-center gap-2">
                    <BrainCircuit className="text-indigo-600 h-5 w-5" />
                    <h2 className="text-lg font-bold text-gray-900">AI Root Cause Diagnostics</h2>
                  </div>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-indigo-50 border border-indigo-150 border-indigo-100 text-indigo-700">
                    Confidence: {activeAnomaly.confidence}
                  </span>
                </div>

                <div className="space-y-4">
                  <div>
                    <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Primary Root Cause</span>
                    <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl text-sm font-semibold text-slate-800 leading-relaxed">
                      {activeAnomaly.rootCause}
                    </div>
                  </div>

                  <div>
                    <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Key Contributing Factors</span>
                    <ul className="space-y-2 ml-1">
                      {activeAnomaly.contributingFactors.map((factor, idx) => (
                        <li key={idx} className="flex items-start text-xs text-gray-700 font-medium leading-relaxed">
                          <span className="inline-block h-1.5 w-1.5 bg-indigo-500 rounded-full mr-2.5 mt-2 flex-shrink-0"></span>
                          <span>{factor}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {/* Requirement 5: Add a new Impact Assessment section */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 transition-shadow hover:shadow-md space-y-4">
                <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                  <FileText className="text-blue-600 h-5 w-5" />
                  <h2 className="text-lg font-bold text-gray-900 border-none">Impact Assessment</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-slate-50/50 border border-slate-100/50 p-4 rounded-xl">
                    <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Investigation Stage</span>
                    <span className="text-sm font-bold text-slate-800">{activeAnomaly.stage}</span>
                  </div>
                  <div className="bg-slate-50/50 border border-slate-100/50 p-4 rounded-xl">
                    <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Parameter Affected</span>
                    <span className="text-sm font-bold text-slate-800 font-mono">{activeAnomaly.parameter}</span>
                  </div>
                  <div className="bg-slate-50/50 border border-slate-100/50 p-4 rounded-xl">
                    <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Assessed Risk Level</span>
                    <span className={`inline-flex px-2.5 py-0.5 rounded text-xs font-semibold font-bold ${
                      activeAnomaly.riskLevel === 'High'
                        ? 'bg-red-100 text-red-800 border border-red-200'
                        : activeAnomaly.riskLevel === 'Medium'
                        ? 'bg-amber-100 text-amber-800 border border-amber-200'
                        : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                    }`}>
                      {activeAnomaly.riskLevel} Risk
                    </span>
                  </div>
                </div>

                <div className="space-y-3 pt-1">
                  <div>
                    <span className="block text-xs font-semibold text-gray-450 text-gray-400 uppercase tracking-wider mb-1">Potential Product Quality Impact</span>
                    <p className="text-xs text-gray-700 font-medium leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">
                      {activeAnomaly.qualityImpact}
                    </p>
                  </div>
                  <div>
                    <span className="block text-xs font-semibold text-gray-450 text-gray-400 uppercase tracking-wider mb-1">Production Operations Impact</span>
                    <p className="text-xs text-gray-700 font-medium leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">
                      {activeAnomaly.productionImpact}
                    </p>
                  </div>
                </div>
              </div>

              {/* Requirement 6 & 7: Corrective Actions & Expected Outcome */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 transition-shadow hover:shadow-md space-y-4">
                <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                  <Settings className="text-indigo-600 h-5 w-5" />
                  <h2 className="text-lg font-bold text-gray-900">AI Corrective Recommendations</h2>
                </div>

                <div className="space-y-4">
                  {/* Recommendations Actions list */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {activeAnomaly.recommendations.map((rec, idx) => (
                      <div key={idx} className="flex items-start text-xs text-gray-800 bg-slate-50 p-3.5 rounded-xl border border-slate-100 font-medium">
                        <CheckCircle className="h-4 w-4 text-emerald-500 mr-2.5 mt-0.5 flex-shrink-0" />
                        <span className="leading-relaxed">{rec}</span>
                      </div>
                    ))}
                  </div>

                  {/* Expected outcome */}
                  <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mt-2">
                    <span className="block text-xs font-bold text-indigo-700 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                      <CheckCircle className="h-3.5 w-3.5" /> Expected Outcome
                    </span>
                    <p className="text-xs text-indigo-905 text-indigo-900 font-medium leading-relaxed leading-5 mt-0.5">
                      {activeAnomaly.expectedOutcome}
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
              <Info className="h-10 w-10 text-gray-400 mb-3" />
              <h3 className="font-semibold text-slate-800">No Anomaly Selected</h3>
              <p className="text-xs text-gray-500 max-w-xs mt-2 leading-relaxed">
                Click an operational anomaly entry from the Record Log panel to run root cause and impact checks.
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
