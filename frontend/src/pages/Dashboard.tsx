import React, { useState, useEffect, useMemo } from 'react';
import { 
  Activity, CheckCircle, AlertTriangle, Package, BarChart3,
  Zap, Clock, ShieldAlert, Award, FileText,
  CheckCircle2, Info, AlertCircle
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceArea, BarChart, Bar } from 'recharts';
import { getMockKPIs, getMockParameters, getMockTrendData, getMockAnomalies } from '../lib/mockData';
import { useFilter } from '../context/FilterContext';
import { fetchPlantCurrentPeriodKpi, fetchRunningBatches, fetchAlerts, fetchBatches, fetchAllBatchKPIs } from '../lib/api';
import type { PlantPeriodKpi, DeviationAlert, BatchKPIs } from '../lib/api';

export default function Dashboard() {
  const { selectedPlant, selectedProduct, selectedBatch, selectedPersona } = useFilter();

  // Real, backed by batch_kpis - a rollup query (mean OEE/Quality/Process
  // Stability across the plant's batches), not a stored column. Only the
  // Manager persona reads this; Operator/QE views are untouched here.

  // Total Production (Current Shift / Today / This Month) - resolves the
  // REAL current shift/day/month (server clock) via
  // fetchPlantCurrentPeriodKpi, not "whichever period is latest in the
  // data" - now that live batch completions carry real timestamps, this
  // genuinely reflects today's calendar date, showing zero rather than a
  // stale period if nothing has completed yet in the current window.
  const [currentShiftKpi, setCurrentShiftKpi] = useState<PlantPeriodKpi | null>(null);
  const [todayKpi, setTodayKpi] = useState<PlantPeriodKpi | null>(null);
  const [thisMonthKpi, setThisMonthKpi] = useState<PlantPeriodKpi | null>(null);
  const [periodKpiError, setPeriodKpiError] = useState<string | null>(null);

  // Production Run Summary side panel - Running Batches count, real live data.
  const [runningBatchCount, setRunningBatchCount] = useState<number | null>(null);

  // Recent Operational Alerts - real, from the Process Parameter Deviation
  // Agent (app.live.deviation_agent / alert_registry), not fake equipment
  // names. Only Open alerts for this plant.
  const [openAlerts, setOpenAlerts] = useState<DeviationAlert[] | null>(null);

  // Plant Performance Trend - real, one point per recent completed batch
  // (real oee_pct vs the golden batch's oee_pct), not a fake 24-hour curve.
  const [batchTrend, setBatchTrend] = useState<{ date: string; batchId: string; current: number; best: number }[] | null>(null);
  const RECENT_BATCH_TREND_COUNT = 10;

  useEffect(() => {
    let cancelled = false;
    setCurrentShiftKpi(null);
    setTodayKpi(null);
    setThisMonthKpi(null);
    setPeriodKpiError(null);
    Promise.all([
      fetchPlantCurrentPeriodKpi(selectedPlant, 'shift'),
      fetchPlantCurrentPeriodKpi(selectedPlant, 'day'),
      fetchPlantCurrentPeriodKpi(selectedPlant, 'month'),
    ])
      .then(([shiftRes, dayRes, monthRes]) => {
        if (cancelled) return;
        setCurrentShiftKpi(shiftRes);
        setTodayKpi(dayRes);
        setThisMonthKpi(monthRes);
      })
      .catch((err) => {
        if (!cancelled) setPeriodKpiError(err instanceof Error ? err.message : String(err));
      });

    setRunningBatchCount(null);
    setOpenAlerts(null);
    Promise.all([fetchRunningBatches(), fetchAlerts('Open')])
      .then(([runningBatches, alerts]) => {
        if (cancelled) return;
        const currentlyRunningIds = new Set(
          runningBatches.filter((b) => b.plant === selectedPlant && b.status === 'Running').map((b) => b.running_batch_id)
        );
        setRunningBatchCount(currentlyRunningIds.size);
        // Only alerts for batches that are STILL Running right now - an
        // Open alert whose batch has since Completed/Stopped no longer
        // reflects a live operational concern for this panel.
        setOpenAlerts(alerts.filter((a) => a.plant === selectedPlant && currentlyRunningIds.has(a.running_batch_id)));
      })
      .catch(() => {
        // Non-critical for this panel - leave as null (renders '—'/empty)
        // rather than surfacing a separate error state.
      });

    setBatchTrend(null);
    // Per-batch OEE - the real recorded value, not a blended composite.
    // OEE is the standard plant-manager "north star" efficiency metric
    // (Availability x Performance x Quality already baked in), a more
    // meaningful trend for this persona than an ad-hoc average.
    const batchPerformance = (k: BatchKPIs) => k.oee_pct;
    Promise.all([fetchBatches('all'), fetchAllBatchKPIs()])
      .then(([batches, kpis]) => {
        if (cancelled) return;
        const kpiByBatchId = new Map(kpis.map((k: BatchKPIs) => [k.batch_id, k]));
        const goldenKpis = kpiByBatchId.get('PAR-GOLDEN');
        const goldenPerformance = goldenKpis ? batchPerformance(goldenKpis) : null;
        // fetchBatches('all') is already sorted newest-first (backend) -
        // take the most recent N, then reverse so the chart reads
        // oldest -> newest left to right.
        const recent = batches
          .filter((b) => b.plant === selectedPlant && b.batch_id !== 'PAR-GOLDEN')
          .slice(0, RECENT_BATCH_TREND_COUNT)
          .reverse();
        setBatchTrend(
          recent
            .map((b) => {
              const batchKpis = kpiByBatchId.get(b.batch_id);
              if (!batchKpis || goldenPerformance === null) return null;
              return { date: b.batch_start_datetime.slice(0, 10), batchId: b.batch_id, current: batchPerformance(batchKpis), best: goldenPerformance };
            })
            .filter((p): p is { date: string; batchId: string; current: number; best: number } => p !== null)
        );
      })
      .catch(() => {
        // Non-critical - leave as null (renders nothing / falls back).
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPlant]);

  const rawBatchCode = selectedBatch === 'All Batches' 
    ? `${selectedPlant.substring(0, 3).toUpperCase()}-${selectedProduct.substring(0, 3).toUpperCase()}-018`
    : selectedBatch;

  // React states called at top level unconditionally
  const [activeParamName, setActiveParamName] = useState('Temperature');
  const [activeAnomalyId, setActiveAnomalyId] = useState<string | null>(null);
  const periodKpiNote = (aggregationVerb: string, value: string, periodData: PlantPeriodKpi) =>
    `${aggregationVerb} across ${periodData.batch_count} batches completed in ${periodData.period_label} → Result: ${value}`;

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

  // Matches backend's MAX_BATCHES_PER_PLANT_PER_DAY (app/live/config.py) -
  // not fetched dynamically, no API exposes it yet; same hardcoded value
  // already shown in the Production Run Summary panel's "Planned runs" card.
  const plannedBatchesPerDay = 20;
  const criticalAlertCount = openAlerts?.filter((a) => a.severity === 'Critical').length ?? 0;

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
            <span className="px-2 py-0.5 rounded text-2xs font-extrabold uppercase bg-blue-50 text-blue-600 border border-blue-200">
              {selectedPersona} View
            </span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mt-1.5">{headerMeta.title}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{headerMeta.subtitle}</p>
        </div>
      </div>

      {/* 1. KPI Cards Row */}
      {selectedPersona === 'Plant Manager' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
          <KPICard title="OEE (This Month)" value={thisMonthKpi ? `${thisMonthKpi.oee_pct}%` : '—'} trend="flat" trendValue={thisMonthKpi ? thisMonthKpi.period_label : periodKpiError ? 'Error' : 'Loading'} desc="Overall equipment effectiveness" icon={<BarChart3 />} color="text-blue-600" bg="bg-blue-50" note={thisMonthKpi ? periodKpiNote('Averaged', `${thisMonthKpi.oee_pct}%`, thisMonthKpi) : undefined} />
          <KPICard title="OEE (Today)" value={todayKpi ? `${todayKpi.oee_pct}%` : '—'} trend="flat" trendValue={todayKpi ? todayKpi.period_label : periodKpiError ? 'Error' : 'Loading'} desc="Overall equipment effectiveness" icon={<BarChart3 />} color="text-blue-600" bg="bg-blue-50" note={todayKpi ? periodKpiNote('Averaged', `${todayKpi.oee_pct}%`, todayKpi) : undefined} />
          <KPICard title="OEE (Current Shift)" value={currentShiftKpi ? `${currentShiftKpi.oee_pct}%` : '—'} trend="flat" trendValue={currentShiftKpi ? currentShiftKpi.period_label : periodKpiError ? 'Error' : 'Loading'} desc="Overall equipment effectiveness" icon={<BarChart3 />} color="text-blue-600" bg="bg-blue-50" note={currentShiftKpi ? periodKpiNote('Averaged', `${currentShiftKpi.oee_pct}%`, currentShiftKpi) : undefined} />
          <KPICard title="Quality Score (This Month)" value={thisMonthKpi ? `${thisMonthKpi.quality_score_pct}%` : '—'} trend="flat" trendValue={thisMonthKpi ? thisMonthKpi.period_label : periodKpiError ? 'Error' : 'Loading'} desc="Production quality" icon={<CheckCircle />} color="text-teal-600" bg="bg-teal-50" note={thisMonthKpi ? periodKpiNote('Averaged', `${thisMonthKpi.quality_score_pct}%`, thisMonthKpi) : undefined} />
          <KPICard title="Quality Score (Today)" value={todayKpi ? `${todayKpi.quality_score_pct}%` : '—'} trend="flat" trendValue={todayKpi ? todayKpi.period_label : periodKpiError ? 'Error' : 'Loading'} desc="Production quality" icon={<CheckCircle />} color="text-teal-600" bg="bg-teal-50" note={todayKpi ? periodKpiNote('Averaged', `${todayKpi.quality_score_pct}%`, todayKpi) : undefined} />
          <KPICard title="Quality Score (Current Shift)" value={currentShiftKpi ? `${currentShiftKpi.quality_score_pct}%` : '—'} trend="flat" trendValue={currentShiftKpi ? currentShiftKpi.period_label : periodKpiError ? 'Error' : 'Loading'} desc="Production quality" icon={<CheckCircle />} color="text-teal-600" bg="bg-teal-50" note={currentShiftKpi ? periodKpiNote('Averaged', `${currentShiftKpi.quality_score_pct}%`, currentShiftKpi) : undefined} />
          <KPICard title="Production (This Month)" value={thisMonthKpi ? `${thisMonthKpi.total_production_kg.toLocaleString()} kg` : '—'} trend="flat" trendValue={thisMonthKpi ? thisMonthKpi.period_label : periodKpiError ? 'Error' : 'Loading'} desc="Latest month in the data" icon={<Package />} color="text-indigo-600" bg="bg-indigo-50" note={thisMonthKpi ? periodKpiNote('Summed', `${thisMonthKpi.total_production_kg.toLocaleString()} kg`, thisMonthKpi) : undefined} />
          <KPICard title="Production (Today)" value={todayKpi ? `${todayKpi.total_production_kg.toLocaleString()} kg` : '—'} trend="flat" trendValue={todayKpi ? todayKpi.period_label : periodKpiError ? 'Error' : 'Loading'} desc="Latest day in the data" icon={<Package />} color="text-indigo-600" bg="bg-indigo-50" note={todayKpi ? periodKpiNote('Summed', `${todayKpi.total_production_kg.toLocaleString()} kg`, todayKpi) : undefined} />
          <KPICard title="Production (Current Shift)" value={currentShiftKpi ? `${currentShiftKpi.total_production_kg.toLocaleString()} kg` : '—'} trend="flat" trendValue={currentShiftKpi ? currentShiftKpi.period_label : periodKpiError ? 'Error' : 'Loading'} desc="Latest completed shift" icon={<Package />} color="text-indigo-600" bg="bg-indigo-50" note={currentShiftKpi ? periodKpiNote('Summed', `${currentShiftKpi.total_production_kg.toLocaleString()} kg`, currentShiftKpi) : undefined} />
          <KPICard title="Active Alerts" value={openAlerts ? String(openAlerts.length) : '—'} trend="flat" trendValue={openAlerts ? (criticalAlertCount > 0 ? `${criticalAlertCount} critical` : 'None critical') : 'Loading'} desc="Current operational warnings" icon={<AlertTriangle />} color="text-amber-600" bg="bg-amber-50" />
        </div>
      )}

      {selectedPersona === 'Plant Operator' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        {/* CHARTS CONTAINER (Left 2/3) */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex flex-col">
          {/* Header area of Chart */}
          {selectedPersona === 'Plant Manager' && (
            <>
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">OEE Trend (Last {RECENT_BATCH_TREND_COUNT} Batches)</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Real OEE per completed batch vs. the golden batch reference</p>
                </div>
                <div className="flex gap-4 text-sm bg-gray-50 border border-gray-100 rounded-lg p-3 shrink-0">
                  <div>
                    <div className="text-gray-500 text-2xs font-bold uppercase tracking-wider">Recent Avg</div>
                    <div className="font-extrabold text-gray-900 text-sm">
                      {batchTrend && batchTrend.length > 0
                        ? `${(batchTrend.reduce((sum, p) => sum + p.current, 0) / batchTrend.length).toFixed(1)}%`
                        : '—'}
                    </div>
                  </div>
                  <div className="w-px bg-gray-200"></div>
                  <div>
                    <div className="text-gray-500 text-2xs font-bold uppercase tracking-wider">Recent Peak</div>
                    <div className="font-extrabold text-yellow-600 text-sm">
                      {batchTrend && batchTrend.length > 0
                        ? `${Math.max(...batchTrend.map((p) => p.current)).toFixed(1)}%`
                        : '—'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="h-72 flex-1 min-h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={batchTrend ?? []}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis
                      dataKey="date"
                      stroke="#9ca3af"
                      tickLine={false}
                      axisLine={false}
                      height={30}
                      interval={0}
                      tick={({ x, y, index }) => {
                        const point = (batchTrend ?? [])[index];
                        return (
                          <g transform={`translate(${x},${y})`}>
                            <text dy={16} textAnchor="middle" fontSize={10} fontWeight={600} fill="#6b7280">{point?.batchId}</text>
                          </g>
                        );
                      }}
                    />
                    <YAxis domain={[0, 100]} stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `${val}%`} />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3' }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        return (
                          <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-2.5 text-xs space-y-1.5 min-w-[160px]">
                            <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-gray-100">
                              <span className="font-bold text-gray-800">{label}</span>
                            </div>
                            <div className="space-y-1">
                              {payload.map((entry) => (
                                <div key={entry.name} className="flex items-center justify-between gap-3" style={{ color: entry.color }}>
                                  <span>{entry.name}</span>
                                  <span className="font-semibold">{Number(entry.value).toFixed(1)}%</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '11px' }}/>
                    <Line type="monotone" dataKey="current" name="OEE" stroke="#3b82f6" strokeWidth={3} dot={false} />
                    <Line type="monotone" dataKey="best" name="Golden Batch OEE" stroke="#eab308" strokeWidth={2.5} dot={false} strokeDasharray="4 4" />
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
                  <div className="font-black text-gray-800 text-base mt-0.5">{runningBatchCount ?? '—'}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs">Completed today</div>
                  <div className="font-black text-gray-800 text-base mt-0.5">{todayKpi ? todayKpi.batch_count : '—'}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs">Planned runs</div>
                  {/* No scheduling/planning concept exists in the backend yet
                      (only completed-historical and currently-running batches)
                      - kept as a placeholder until that data model exists. */}
                  <div className="font-black text-gray-800 text-base mt-0.5">{plannedBatchesPerDay}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs">Active Shift</div>
                  <div className="font-extrabold text-blue-600 text-sm mt-0.5">{currentShiftKpi ? currentShiftKpi.period_label : '—'}</div>
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
                  <span className="text-2xs text-gray-400 uppercase">Average</span>
                  <span className="text-sm font-extrabold text-slate-800 mt-0.5">{stats.avg}</span>
                </div>
                <div className="bg-gray-50 border border-gray-100 p-2.5 rounded-lg flex flex-col justify-center">
                  <span className="text-2xs text-gray-400 uppercase">Std Dev</span>
                  <span className="text-sm font-extrabold text-slate-800 mt-0.5">{stats.stdDev}</span>
                </div>
                <div className="bg-gray-50 border border-gray-100 p-2.5 rounded-lg flex flex-col justify-center">
                  <span className="text-2xs text-gray-400 uppercase">Min / Max</span>
                  <span className="text-2xs font-extrabold text-slate-800 mt-0.5">{stats.min} / {stats.max}</span>
                </div>
                <div className="bg-gray-50 border border-gray-100 p-2.5 rounded-lg flex flex-col justify-center">
                  <span className="text-2xs text-gray-400 uppercase">Variance</span>
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
              <p className="text-2xs text-gray-500 font-semibold leading-relaxed text-center">
                {qualityReport.releaseExplanation}
              </p>
            </div>
          )}

          {/* Bottom Side Panel Card (Insights) - Plant Manager has no card here;
              its insights list was removed, and there's nothing else plant-wide
              to show in this slot. */}
          {selectedPersona !== 'Plant Manager' && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex-1 flex flex-col justify-between">
            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-widest mb-3.5 flex items-center gap-2">
              <Zap className="text-amber-500 h-5 w-5" /> {selectedPersona === 'Plant Operator' ? 'AI Process Observation' : 'AI Quality Assessment'}
            </h2>

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
                  <div className="text-2xs font-bold text-gray-400 flex items-center gap-1.5 pt-3 border-t border-gray-150">
                    Target Band: <span className="bg-white px-2 py-0.5 rounded border border-gray-200 font-mono text-2xs">{activeParamObj.lowerLimit}-{activeParamObj.upperLimit} {activeParamObj.unit}</span>
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
          )}

        </div>
      </div>

      {/* 3. Wide Bottom Panel */}
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
                  <div className="flex justify-between items-start mb-2 gap-2 min-w-0">
                    <span className="text-xs font-bold truncate">{p.name}</span>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      p.status === 'normal' ? 'bg-green-500' : p.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                    }`}></span>
                  </div>
                  <div className="text-lg font-black mt-2">{p.current} {p.unit}</div>
                  <div className="text-2xs font-bold text-gray-400 mt-1 flex justify-between">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
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
                    <div className="flex justify-between items-center gap-2 text-2xs font-bold text-gray-405 text-gray-400 mb-1 min-w-0">
                      <span className="truncate">{anm.id}</span>
                      <span className="shrink-0">{anm.time}</span>
                    </div>
                    <span className="text-xs font-black text-gray-700 block mb-1.5">{anm.parameter} Exception</span>
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-2xs font-black uppercase ${
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
                      <p className="text-2xs text-gray-400 font-bold mt-1">Stage: {activeAnomaly.stage} | Risk: {activeAnomaly.riskLevel}</p>
                    </div>
                  </div>
                  <div>
                    <span className="text-2xs font-bold text-gray-400 uppercase tracking-widest block mb-1">Root Cause Analysis</span>
                    <p className="text-xs text-gray-700 leading-relaxed font-semibold bg-white p-3 border border-gray-200 rounded-lg">{activeAnomaly.rootCause}</p>
                  </div>
                  <div>
                    <span className="text-2xs font-bold text-gray-400 uppercase tracking-widest block mb-1">Assessed Product Quality Impact</span>
                    <p className="text-xs text-gray-600 leading-relaxed font-semibold">{activeAnomaly.qualityImpact}</p>
                  </div>
                  <div>
                    <span className="text-2xs font-bold text-gray-400 uppercase tracking-widest block mb-1">Corrective recommendation directives</span>
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
  title, value, trend: _trend, trendValue, desc, icon, color, bg, note
}: {
  title: string, value: string, trend?: 'up' | 'down' | 'flat', trendValue: string, desc: string, icon: React.ReactNode, color: string, bg: string, note?: string
}) {
  const hasNote = !!note;
  // Revealed in normal document flow (not an absolutely-positioned overlay/modal)
  // so it pushes the card taller instead of covering the value/description above it.
  const [showNote, setShowNote] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col justify-between hover:shadow-md transition-all duration-200">
      <div className="flex justify-between items-start mb-2">
        <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">{title}</p>
        {hasNote ? (
          <button
            type="button"
            onClick={() => setShowNote((s) => !s)}
            className="text-indigo-400 hover:text-indigo-600 transition-colors"
          >
            <Info size={14} />
          </button>
        ) : (
          <div className={`p-1.5 rounded-lg ${bg} ${color}`}>
            {React.cloneElement(icon as React.ReactElement, { size: 16 })}
          </div>
        )}
      </div>
      <div>
        <div className="flex items-end gap-2 mb-1">
          <p className="text-lg font-black text-gray-900 leading-none">{value}</p>
          <div className="flex items-center text-2xs font-bold mb-0.5">
            <span className={
              trendValue.includes('+') || trendValue === 'Warning' || trendValue === 'Critical'
                ? 'text-rose-600'
                : trendValue === 'Normal' || trendValue === 'Approved' || trendValue.includes('Track') || trendValue.includes('Asses') || trendValue.includes('Check')
                ? 'text-emerald-600'
                : 'text-gray-500'
            }>{trendValue}</span>
          </div>
        </div>
        <p className="text-2xs font-semibold text-gray-400 leading-tight mt-1">{desc}</p>
        {hasNote && showNote && (
          <p className="text-2xs font-semibold text-indigo-500 leading-snug mt-2 pt-2 border-t border-gray-100">{note}</p>
        )}
      </div>
    </div>
  );
}
