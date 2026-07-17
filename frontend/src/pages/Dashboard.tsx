import React, { useState, useEffect, useMemo } from 'react';
import { 
  Activity, CheckCircle, AlertTriangle, Package, BarChart3,
  Zap, Clock, ShieldAlert, Award, FileText,
  CheckCircle2, Info, AlertCircle
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceArea, BarChart, Bar } from 'recharts';
import { getMockKPIs, getMockParameters, getMockTrendData, getMockAnomalies } from '../lib/mockData';
import { useFilter } from '../context/FilterContext';

export default function Dashboard() {
  const { selectedPlant, selectedProduct, selectedBatch, selectedPersona } = useFilter();

  const rawBatchCode = selectedBatch === 'All Batches' 
    ? `${selectedPlant.substring(0, 3).toUpperCase()}-${selectedProduct.substring(0, 3).toUpperCase()}-018`
    : selectedBatch;

  // React states called at top level unconditionally
  const [activeParamName, setActiveParamName] = useState('Temperature');
  const [activeAnomalyId, setActiveAnomalyId] = useState<string | null>(null);

  // Core Mock data runs safely for all personas
  const mockKPIs = getMockKPIs(selectedPlant, selectedProduct);
  const mockParameters = getMockParameters(rawBatchCode);
  const mockTrendData = getMockTrendData(rawBatchCode);
  const rawAnomalies = getMockAnomalies(rawBatchCode);

  // Sync active parameter when parameters change
  useEffect(() => {
    if (mockParameters.length > 0) {
      const exists = mockParameters.some(p => p.name === activeParamName);
      if (!exists) {
        setActiveParamName(mockParameters[0].name);
      }
    }
  }, [rawBatchCode, mockParameters, activeParamName]);

  const activeParamObj = mockParameters.find(p => p.name === activeParamName) || mockParameters[0];

  // Operator Trend Stats Calculation
  const stats = useMemo(() => {
    if (!activeParamObj || mockTrendData.length === 0) return { avg: 0, min: 0, max: 0, variance: 0, stdDev: 0 };
    
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    
    mockTrendData.forEach(d => {
      const val = d[activeParamName] as number;
      if (val !== undefined) {
        sum += val;
        if (val < min) min = val;
        if (val > max) max = val;
      }
    });
    
    const count = mockTrendData.length;
    const avg = sum / count;
    
    let sqSum = 0;
    mockTrendData.forEach(d => {
      const val = d[activeParamName] as number;
      if (val !== undefined) sqSum += Math.pow(val - avg, 2);
    });
    
    const variance = sqSum / count;
    const stdDev = Math.sqrt(variance);

    const format = (num: number) => {
      return parseFloat(num.toFixed(activeParamObj.current % 1 === 0 ? 0 : 2));
    };

    return {
      avg: format(avg),
      min: format(min === Infinity ? 0 : min),
      max: format(max === -Infinity ? 0 : max),
      variance: format(variance),
      stdDev: format(stdDev)
    };
  }, [activeParamName, mockTrendData, activeParamObj]);

  // Quality Report resolution
  const qualityReport = useMemo(() => {
    const suffix = rawBatchCode.substring(rawBatchCode.length - 3);
    if (suffix === '018') {
      return {
        score: '97.4%',
        status: 'Requires Review',
        passedCount: '4 / 5',
        risk: 'Medium',
        riskColor: 'text-amber-600 bg-amber-50 border-amber-100',
        statusColor: 'text-amber-800 bg-amber-100 border-amber-250',
        aiSummary: 'The selected batch has completed primary granulation. However, the final moisture level (2.3%) is hovering above the target ceiling of 2.0%. A drying stage verification is recommended before release.',
        releaseStatus: 'Requires Review',
        releaseExplanation: 'Moisture levels exceed normal ceiling limit by 0.3%. Granulation temperature deviation investigation advised.'
      };
    }
    if (suffix === '017') {
      return {
        score: '99.4%',
        status: 'Approved',
        passedCount: '5 / 5',
        risk: 'Low',
        riskColor: 'text-emerald-700 bg-emerald-50 border-emerald-105 border-emerald-100',
        statusColor: 'text-emerald-800 bg-emerald-100 border-emerald-250',
        aiSummary: 'The selected batch conforms strictly to Critical Quality Attributes. Purities, hardness metrics, and dissolution profiles exceed standards. Approved for immediate release.',
        releaseStatus: 'Approved for Release',
        releaseExplanation: 'Batch complies fully with compendial specification bounds. Release recommended.'
      };
    }
    if (suffix === '016') {
      return {
        score: '91.2%',
        status: 'Requires Review',
        passedCount: '1 / 5',
        risk: 'High',
        riskColor: 'text-rose-700 bg-rose-50 border-rose-100',
        statusColor: 'text-rose-800 bg-rose-100 border-rose-250',
        aiSummary: 'Critical failures detected in Dissolution, Purity, Content Uniformity and Hardness attributes. Rejecting release recommendation. In-depth investigation requested.',
        releaseStatus: 'Requires Review',
        releaseExplanation: 'Critical spec violations in hardness and purity prevent automated release flow.'
      };
    }
    return {
      score: '99.8%',
      status: 'Approved',
      passedCount: '5 / 5',
      risk: 'Low',
      riskColor: 'text-emerald-700 bg-emerald-50 border-emerald-100',
      statusColor: 'text-emerald-800 bg-emerald-100 border-emerald-250',
      aiSummary: 'Excellent analytical uniformity and purity matching Golden Reference Batch conditions. Released with high confidence.',
      releaseStatus: 'Approved for Release',
      releaseExplanation: 'Strict compliance with golden parameters verified. Ready for inventory release.'
    };
  }, [rawBatchCode]);

  // Quality Anomaly Log resolution
  const enrichedAnomalies = useMemo(() => {
    return rawAnomalies.map((anm, idx) => {
      const isFirst = idx === 0 || anm.parameter.toLowerCase().includes('flow');
      if (isFirst) {
        return {
          ...anm,
          stage: 'Drying & Solvent Recovery',
          riskLevel: 'High',
          rootCause: 'Primary dry-bleed exhaust damper actuator sticking due to thermal expansion variance (+4.5°C over control threshold).',
          qualityImpact: 'Potential moisture level deviation in the final granule blend. Dissolution profile may drift if final drying runtime is not extended.',
          recommendations: [
            'Reduce drying airflow by 3% to normalize static pressure',
            'Verify pressure sensor calibration on Dryer-03',
            'Inspect inlet air temperature controls for sensor drift'
          ]
        };
      }
      return {
        ...anm,
        stage: 'Granulation Mixing',
        riskLevel: 'Medium',
        rootCause: 'Slight powder feed rate fluctuations from the micro-feeder screw conveyor due to bulk density variance.',
        qualityImpact: 'Slight granule size distribution variation. Higher particle agglomeration rate in tablet press stage.',
        recommendations: [
          'Execute zero-point calibration on feed hopper weigh scales',
          'Inspect screw feeder conveyor for product buildup',
          'Maintain agitator drive shaft speed locked at 22 RPM'
        ]
      };
    });
  }, [rawAnomalies]);

  // Sync anomaly selection
  useEffect(() => {
    if (enrichedAnomalies.length > 0) {
      const exists = enrichedAnomalies.some(a => a.id === activeAnomalyId);
      if (!exists) {
        setActiveAnomalyId(enrichedAnomalies[0].id);
      }
    } else {
      setActiveAnomalyId(null);
    }
  }, [enrichedAnomalies, activeAnomalyId]);

  const activeAnomaly = enrichedAnomalies.find(a => a.id === activeAnomalyId) || enrichedAnomalies[0] || null;

  // AI insights
  const aiExecutiveInsights = [
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

  /* ---------------- RENDERING DECISIONS ---------------- */

  // Header Details
  const getHeaderDetails = () => {
    if (selectedPersona === 'Plant Operator') {
      return {
        title: `${selectedPlant} Live Monitoring`,
        subtitle: `Active Batch: ${rawBatchCode} | Real-Time Operations Monitoring Console`
      };
    }
    if (selectedPersona === 'Quality Engineer') {
      return {
        title: `${selectedPlant} Quality Analytics`,
        subtitle: `Batch: ${rawBatchCode} | Critical Quality Attributes & Release Assessment`
      };
    }
    return {
      title: `${selectedPlant} Performance`,
      subtitle: `Product: ${selectedProduct} | Overall Plant Health & Production Overview`
    };
  };

  const headerMeta = getHeaderDetails();

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-2 border-b border-gray-205 border-gray-200 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-blue-50 text-blue-600 border border-blue-200">
              {selectedPersona} View
            </span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mt-1.5">{headerMeta.title}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{headerMeta.subtitle}</p>
        </div>
      </div>

      {/* 1. KPI Cards Row */}
      {selectedPersona === 'Plant Manager' && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <KPICard title="Plant Performance" value="94%" trend="up" trendValue="+1.2%" desc="Overall health & efficiency" icon={<Activity />} color="text-emerald-600" bg="bg-emerald-50" />
          <KPICard title="OEE" value={`${mockKPIs.oee}%`} trend="up" trendValue="+0.8%" desc="Overall equipment effectiveness" icon={<BarChart3 />} color="text-blue-600" bg="bg-blue-50" />
          <KPICard title="Quality Score" value={`${mockKPIs.qualityScore}%`} trend="flat" trendValue="0.0%" desc="Today's production quality" icon={<CheckCircle />} color="text-teal-600" bg="bg-teal-50" />
          <KPICard title="Production Status" value="4 / 6" trend="up" trendValue="On Track" desc="Running vs Completed Batches" icon={<Package />} color="text-indigo-600" bg="bg-indigo-50" />
          <KPICard title="Active Alerts" value="2" trend="down" trendValue="-3 issues" desc="Current operational warnings" icon={<AlertTriangle />} color="text-amber-600" bg="bg-amber-50" />
        </div>
      )}

      {selectedPersona === 'Plant Operator' && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <KPICard title="Batch Progress" value={`${mockKPIs.goldenBatchSimilarity + 1}%`} trend="up" trendValue="In Progress" desc="Estimated ~45 mins left" icon={<Clock />} color="text-blue-600" bg="bg-blue-50" />
          {mockParameters.slice(0, 4).map(p => (
            <KPICard 
              key={p.name}
              title={p.name} 
              value={`${p.current} ${p.unit}`} 
              trend={p.status === 'normal' ? 'flat' : p.status === 'warning' ? 'up' : 'down'}
              trendValue={p.status === 'normal' ? 'Normal' : p.status === 'warning' ? 'Warning' : 'Critical'} 
              desc={`Target Golden: ${p.golden} ${p.unit}`} 
              icon={<Activity />} 
              color={p.status === 'normal' ? 'text-emerald-600' : p.status === 'warning' ? 'text-amber-600' : 'text-rose-600'} 
              bg={p.status === 'normal' ? 'bg-emerald-50' : p.status === 'warning' ? 'bg-amber-50' : 'bg-rose-50'} 
            />
          ))}
        </div>
      )}

      {selectedPersona === 'Quality Engineer' && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <KPICard title="Overall Quality Score" value={qualityReport.score} trend="up" trendValue="+0.4%" desc="Target threshold: >95%" icon={<Award />} color="text-indigo-600" bg="bg-indigo-50" />
          <KPICard 
            title="Release Status" 
            value={qualityReport.status} 
            trend="flat" 
            trendValue={qualityReport.risk + ' Risk'} 
            desc="CQA Compliance evaluation" 
            icon={<FileText />} 
            color={qualityReport.status === 'Approved' ? 'text-emerald-600' : 'text-amber-600'} 
            bg={qualityReport.status === 'Approved' ? 'bg-emerald-50/50' : 'bg-amber-50/50'} 
          />
          <KPICard title="CQAs Passed" value={qualityReport.passedCount} trend="flat" trendValue="Verified" desc="Passed Critical attributes" icon={<CheckCircle2 />} color="text-teal-600" bg="bg-teal-50" />
          <KPICard title="Active Incident Record" value={rawAnomalies.length.toString()} trend="flat" trendValue="Log Checked" desc="Total anomalies in run" icon={<ShieldAlert />} color="text-amber-600" bg="bg-amber-50" />
          <KPICard title="Risk Profile" value={`${qualityReport.risk} Risk`} trend="down" trendValue="-1 mitig" desc="Assessed quality exception risk" icon={<AlertCircle />} color={qualityReport.risk === 'Low' ? 'text-emerald-700' : 'text-amber-700'} bg={qualityReport.riskColor} />
        </div>
      )}

      {/* 2. Main content split grid (Chart + Side panels) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* CHARTS CONTAINER (Left 2/3) */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex flex-col">
          {/* Header area of Chart */}
          {selectedPersona === 'Plant Manager' && (
            <>
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Plant Performance Trend (24 Hours)</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Comparing current shift efficiency against historical peak average</p>
                </div>
                <div className="flex gap-4 text-sm bg-gray-50 border border-gray-100 rounded-lg p-3 shrink-0">
                  <div>
                    <div className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Today's Avg</div>
                    <div className="font-extrabold text-gray-900 text-sm">93.5%</div>
                  </div>
                  <div className="w-px bg-gray-200"></div>
                  <div>
                    <div className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Historical Peak</div>
                    <div className="font-extrabold text-yellow-600 text-sm">96.2%</div>
                  </div>
                </div>
              </div>
              
              <div className="h-72 flex-1 min-h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={[
                    { time: '00:00', current: mockKPIs.plantPerformance - 6, best: 95 },
                    { time: '04:00', current: mockKPIs.plantPerformance - 2, best: 96 },
                    { time: '08:00', current: mockKPIs.plantPerformance + 1, best: 96 },
                    { time: '12:00', current: mockKPIs.plantPerformance - 3, best: 97 },
                    { time: '16:00', current: mockKPIs.plantPerformance, best: 96 },
                    { time: '20:00', current: mockKPIs.plantPerformance + 2, best: 98 },
                    { time: '24:00', current: mockKPIs.plantPerformance + 1, best: 97 }
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis domain={[80, 100]} stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `${val}%`} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '11px' }}/>
                    <Line type="monotone" dataKey="current" name="Current Shift Performance" stroke="#3b82f6" strokeWidth={3} dot={false} />
                    <Line type="monotone" dataKey="best" name="Optimal Reference Run" stroke="#eab308" strokeWidth={2.5} dot={false} strokeDasharray="4 4" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {selectedPersona === 'Plant Operator' && (
            <>
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Parameter Trend Comparison</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Real-time telemetry plotted against target golden envelope bands</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Parameter:</span>
                  <select 
                    value={activeParamName}
                    onChange={(e) => setActiveParamName(e.target.value)}
                    className="bg-gray-50 border border-gray-200 text-xs text-gray-800 rounded-md py-1 px-2.5 outline-none focus:ring-2 focus:ring-blue-500 font-bold cursor-pointer"
                  >
                    {mockParameters.map(p => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="h-72 flex-1 min-h-[250px] relative">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={mockTrendData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="time" stroke="#9ca3af" fontSize={11} minTickGap={25} />
                    <YAxis 
                      domain={['dataMin - ' + (activeParamObj.upperLimit - activeParamObj.lowerLimit)*0.2, 'dataMax + ' + (activeParamObj.upperLimit - activeParamObj.lowerLimit)*0.2]} 
                      stroke="#6b7280" 
                      fontSize={11} 
                      tickFormatter={(val) => typeof val === 'number' ? val.toFixed(1) : val}
                    />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }} />
                    <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '11px' }} />
                    <ReferenceArea y1={activeParamObj.lowerLimit} y2={activeParamObj.upperLimit} fill="#eab308" fillOpacity={0.06} />
                    <Line type="monotone" dataKey={activeParamName} name={`Current ${activeParamName}`} stroke="#3b82f6" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey={`golden_${activeParamName}`} name={`Golden target ${activeParamName}`} stroke="#eab308" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {selectedPersona === 'Quality Engineer' && (
            <>
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-lg font-bold text-gray-901 text-gray-900 mb-0.5">Critical Quality Drivers</h2>
                  <p className="text-xs text-gray-400">Statistical correlation impact weights on final batch release approval specs</p>
                </div>
              </div>
              
              <div className="h-72 flex-1 min-h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[
                    { parameter: 'Drying Time', influence: 85 },
                    { parameter: 'Temperature', influence: 72 },
                    { parameter: 'Mixing Speed', influence: 62 },
                    { parameter: 'Pressure', influence: 41 },
                    { parameter: 'Humidity', influence: 18 }
                  ]} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                    <XAxis type="number" domain={[0, 100]} hide />
                    <YAxis dataKey="parameter" type="category" width={110} axisLine={false} tickLine={false} tick={{fill: '#475569', fontSize: 11, fontWeight: 600}} />
                    <Tooltip cursor={{fill: '#f8fafc'}} />
                    <Bar dataKey="influence" name="Influence Weight (%)" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>

        {/* SIDE PANELS (Right 1/3) */}
        <div className="flex flex-col gap-6">
          {/* Top Side Panel Card */}
          {selectedPersona === 'Plant Manager' && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-sm font-bold text-gray-800 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Package className="text-indigo-500 h-5 w-5" /> Production Run Summary
              </h2>
              <div className="grid grid-cols-2 gap-y-4 gap-x-2 text-sm">
                <div>
                  <div className="text-gray-400 text-xs">Running Batches</div>
                  <div className="font-black text-gray-800 text-base mt-0.5">2</div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs">Completed today</div>
                  <div className="font-black text-gray-800 text-base mt-0.5">4</div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs">Planned runs</div>
                  <div className="font-black text-gray-800 text-base mt-0.5">8</div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs">Active Shift</div>
                  <div className="font-extrabold text-blue-600 text-sm mt-0.5">Day Shift B</div>
                </div>
              </div>
            </div>
          )}

          {selectedPersona === 'Plant Operator' && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h2 className="text-sm font-bold text-gray-800 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Info className="text-blue-500 h-4.5 w-4.5" /> telemetry stats ({activeParamName})
              </h2>
              <div className="grid grid-cols-2 gap-4 text-xs font-semibold">
                <div className="bg-gray-50 border border-gray-100 p-2.5 rounded-lg flex flex-col justify-center">
                  <span className="text-[10px] text-gray-400 uppercase">Average</span>
                  <span className="text-sm font-extrabold text-slate-800 mt-0.5">{stats.avg}</span>
                </div>
                <div className="bg-gray-50 border border-gray-100 p-2.5 rounded-lg flex flex-col justify-center">
                  <span className="text-[10px] text-gray-400 uppercase">Std Dev</span>
                  <span className="text-sm font-extrabold text-slate-800 mt-0.5">{stats.stdDev}</span>
                </div>
                <div className="bg-gray-50 border border-gray-100 p-2.5 rounded-lg flex flex-col justify-center">
                  <span className="text-[10px] text-gray-400 uppercase">Min / Max</span>
                  <span className="text-[10px] font-extrabold text-slate-800 mt-0.5">{stats.min} / {stats.max}</span>
                </div>
                <div className="bg-gray-50 border border-gray-100 p-2.5 rounded-lg flex flex-col justify-center">
                  <span className="text-[10px] text-gray-400 uppercase">Variance</span>
                  <span className="text-sm font-extrabold text-slate-800 mt-0.5">{stats.variance}</span>
                </div>
              </div>
            </div>
          )}

          {selectedPersona === 'Quality Engineer' && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3.5">
              <h2 className="text-sm font-bold text-gray-800 uppercase tracking-widest flex items-center gap-2">
                <ShieldAlert className="text-teal-600 h-5 w-5" /> Release Recommendation
              </h2>
              <div className={`p-4 rounded-xl border text-center ${
                qualityReport.releaseStatus === 'Approved for Release'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-amber-50/50 text-amber-800 border-amber-200'
              }`}>
                {qualityReport.releaseStatus === 'Approved for Release' ? (
                  <div className="flex flex-col items-center gap-1">
                    <CheckCircle2 size={24} className="text-emerald-600" />
                    <span className="text-xs font-black uppercase tracking-wider mt-1">Ready for Release</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <AlertCircle size={24} className="text-amber-600" />
                    <span className="text-xs font-black uppercase tracking-wider mt-1">Requires Review / Action</span>
                  </div>
                )}
              </div>
              <p className="text-[11px] text-gray-500 font-semibold leading-relaxed text-center">
                {qualityReport.releaseExplanation}
              </p>
            </div>
          )}

          {/* Bottom Side Panel Card (Insights) */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex-1 flex flex-col justify-between">
            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-widest mb-3.5 flex items-center gap-2">
              <Zap className="text-amber-500 h-5 w-5" /> AI {selectedPersona === 'Plant Manager' ? 'Plant Insights' : selectedPersona === 'Plant Operator' ? 'Process Observation' : 'Quality Assessment'}
            </h2>
            
            {selectedPersona === 'Plant Manager' && (
              <ul className="space-y-2.5">
                {aiExecutiveInsights.map((insight, idx) => (
                  <li key={idx} className="flex items-start text-xs font-semibold leading-snug">
                    <span className="text-indigo-500 mr-2 mt-0.5 font-extrabold">•</span>
                    <span className="text-gray-600">{insight}</span>
                  </li>
                ))}
              </ul>
            )}

            {selectedPersona === 'Plant Operator' && (
              <div className={`p-4 rounded-xl border flex-1 flex items-center ${activeParamObj.status === 'normal' ? 'bg-slate-50 border-gray-200 text-gray-700' : activeParamObj.status === 'warning' ? 'bg-yellow-50/70 border-yellow-250 text-yellow-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                <div className="space-y-3">
                  <p className="text-xs leading-relaxed font-bold">
                    {activeParamObj.status === 'normal' 
                      ? `${activeParamName} is operating normally with a stable deviation of ${(activeParamObj.current - activeParamObj.golden).toFixed(2)} ${activeParamObj.unit}. The current trend closely aligns with the Golden Batch profile.`
                      : activeParamObj.status === 'warning'
                      ? `Warning: ${activeParamName} is drifting (+${(activeParamObj.current - activeParamObj.golden).toFixed(2)} ${activeParamObj.unit}). The parameter is nearing the control thresholds.`
                      : `Critical deviation detected in ${activeParamName} (${(activeParamObj.current - activeParamObj.golden).toFixed(2)} ${activeParamObj.unit}). Process has exceeded bounds.`}
                  </p>
                  <div className="text-[10px] font-bold text-gray-400 flex items-center gap-1.5 pt-3 border-t border-gray-150">
                    Target Band: <span className="bg-white px-2 py-0.5 rounded border border-gray-200 font-mono text-[9px]">{activeParamObj.lowerLimit}-{activeParamObj.upperLimit} {activeParamObj.unit}</span>
                  </div>
                </div>
              </div>
            )}

            {selectedPersona === 'Quality Engineer' && (
              <div className="bg-slate-50 border border-gray-100 rounded-xl p-4 flex-1 flex flex-col justify-center">
                <p className="text-xs text-gray-650 text-gray-600 italic font-semibold leading-relaxed">
                  "{qualityReport.aiSummary}"
                </p>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* 3. Wide Bottom Panel */}
      {selectedPersona === 'Plant Manager' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-800 uppercase tracking-widest mb-4 flex items-center gap-2">
            <AlertTriangle className="text-red-500 h-5 w-5" /> Recent Operational Alerts
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {recentAlerts.map(alert => (
              <div key={alert.id} className="p-4 rounded-lg border border-gray-100 bg-gray-50 hover:bg-white hover:shadow-sm transition-all duration-200">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                    alert.severity === 'Critical' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {alert.severity}
                  </span>
                  <span className="text-xs font-black text-gray-800">{alert.equipment}</span>
                </div>
                <p className="text-xs text-gray-500 leading-normal font-semibold">{alert.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedPersona === 'Plant Operator' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-800 uppercase tracking-widest mb-4 flex items-center gap-2">
            <ShieldAlert className="text-amber-500 h-5 w-5" /> Parameter Alert Log
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {mockParameters.map(p => {
              const dev = p.current - p.golden;
              return (
                <div key={p.name} className={`p-4 rounded-xl border transition-all hover:shadow-sm ${
                  p.status === 'normal' 
                    ? 'bg-slate-50 border-gray-100 hover:bg-white' 
                    : p.status === 'warning' 
                    ? 'bg-yellow-50 border-yellow-200 text-yellow-800 hover:bg-white' 
                    : 'bg-red-50 border-red-200 text-red-800 hover:bg-white'
                }`}>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs font-bold">{p.name}</span>
                    <span className={`w-2 h-2 rounded-full ${
                      p.status === 'normal' ? 'bg-green-500' : p.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                    }`}></span>
                  </div>
                  <div className="text-lg font-black mt-2">{p.current} {p.unit}</div>
                  <div className="text-[10px] font-bold text-gray-400 mt-1 flex justify-between">
                    <span>Target: {p.golden}</span>
                    <span className={dev > 0 ? 'text-red-500' : 'text-blue-500'}>
                      Dev: {dev > 0 ? '+' : ''}{dev.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selectedPersona === 'Quality Engineer' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between pl-1">
            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-widest flex items-center gap-2">
              <ShieldAlert className="text-amber-505 text-amber-500 h-5 w-5" /> Incident Investigation Log
            </h2>
            <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2.5 py-0.5 rounded-full">{enrichedAnomalies.length} Records</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* List left (1/3) */}
            <div className="md:col-span-1 space-y-3 max-h-[300px] overflow-y-auto pr-1">
              {enrichedAnomalies.map((anm) => {
                const isActive = activeAnomaly?.id === anm.id;
                const isCritical = anm.severity === 'High' || anm.riskLevel === 'High';
                return (
                  <div 
                    key={anm.id} 
                    onClick={() => setActiveAnomalyId(anm.id)}
                    className={`bg-white rounded-xl border p-4 cursor-pointer transition-all hover:bg-slate-50 ${
                      isActive 
                        ? 'border-indigo-500 ring-2 ring-indigo-50 font-bold' 
                        : 'border-gray-200'
                    }`}
                  >
                    <div className="flex justify-between items-center text-[10px] font-bold text-gray-405 text-gray-400 mb-1">
                      <span>{anm.id}</span>
                      <span>{anm.time}</span>
                    </div>
                    <span className="text-xs font-black text-gray-700 block mb-1.5">{anm.parameter} Exception</span>
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${
                      isCritical ? 'bg-red-105 bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {isCritical ? 'Critical' : 'Warning'}
                    </span>
                  </div>
                );
              })}
            </div>
            
            {/* Detail right (2/3) */}
            <div className="md:col-span-2 bg-slate-50 border border-gray-150 rounded-xl p-5">
              {activeAnomaly ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-start border-b border-gray-200 pb-2">
                    <div>
                      <h3 className="text-sm font-black text-gray-800">{activeAnomaly.id} - {activeAnomaly.parameter} Deviation</h3>
                      <p className="text-[10px] text-gray-400 font-bold mt-1">Stage: {activeAnomaly.stage} | Risk: {activeAnomaly.riskLevel}</p>
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Root Cause Analysis</span>
                    <p className="text-xs text-gray-700 leading-relaxed font-semibold bg-white p-3 border border-gray-200 rounded-lg">{activeAnomaly.rootCause}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Assessed Product Quality Impact</span>
                    <p className="text-xs text-gray-600 leading-relaxed font-semibold">{activeAnomaly.qualityImpact}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Corrective recommendation directives</span>
                    <ul className="list-disc pl-4 space-y-1 mt-1 text-xs text-indigo-700 font-bold">
                      {activeAnomaly.recommendations.map((rec, i) => <li key={i}>{rec}</li>)}
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="text-center text-gray-400 py-10 font-bold text-xs select-none">No anomaly selected for root-cause check</div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function KPICard({ 
  title, value, trend: _trend, trendValue, desc, icon, color, bg 
}: { 
  title: string, value: string, trend?: 'up' | 'down' | 'flat', trendValue: string, desc: string, icon: React.ReactNode, color: string, bg: string 
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col justify-between hover:shadow-md transition-shadow duration-200">
      <div className="flex justify-between items-start mb-2">
        <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">{title}</p>
        <div className={`p-1.5 rounded-lg ${bg} ${color}`}>
          {React.cloneElement(icon as React.ReactElement, { size: 16 })}
        </div>
      </div>
      <div>
        <div className="flex items-end gap-2 mb-1">
          <p className="text-lg font-black text-gray-900 leading-none">{value}</p>
          <div className="flex items-center text-[10px] font-bold mb-0.5">
            <span className={
              trendValue.includes('+') || trendValue === 'Warning' || trendValue === 'Critical' 
                ? 'text-rose-600' 
                : trendValue === 'Normal' || trendValue === 'Approved' || trendValue.includes('Track') || trendValue.includes('Asses') || trendValue.includes('Check')
                ? 'text-emerald-600'
                : 'text-gray-500'
            }>{trendValue}</span>
          </div>
        </div>
        <p className="text-[10px] font-semibold text-gray-400 leading-tight mt-1">{desc}</p>
      </div>
    </div>
  );
}
