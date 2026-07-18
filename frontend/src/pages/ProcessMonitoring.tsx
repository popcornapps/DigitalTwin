import { useState, useMemo, useEffect } from 'react';
import { LineChart, Line, ReferenceArea, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { getMockTrendData, getMockParameters } from '../lib/mockData';
import { useFilter } from '../context/FilterContext';
import { BrainCircuit, Info } from 'lucide-react';

export default function ProcessMonitoring() {
  const { availableBatches, selectedPlant } = useFilter();

  const runningBatches = availableBatches.filter(b => b.includes('018') || b.includes('Running'));
  const [localBatch, setLocalBatch] = useState(runningBatches.length > 0 ? runningBatches[0] : availableBatches[0]);

  useEffect(() => {
    const running = availableBatches.filter(b => b.includes('018') || b.includes('Running'));
    if (running.length > 0) setLocalBatch(running[0]);
    else setLocalBatch(availableBatches[0]);
  }, [availableBatches]);

  const initialParameters = useMemo(() => getMockParameters(localBatch), [localBatch]);
  const initialTrendData = useMemo(() => getMockTrendData(localBatch), [localBatch]);

  const [liveParameters, setLiveParameters] = useState(initialParameters);
  const [liveTrendData, setLiveTrendData] = useState(initialTrendData);
  const [lastUpdated, setLastUpdated] = useState(new Date().toLocaleTimeString());

  useEffect(() => {
    setLiveParameters(initialParameters);
    setLiveTrendData(initialTrendData);
    setLastUpdated(new Date().toLocaleTimeString());

    const interval = setInterval(() => {
      setLiveTrendData(prev => {
        const newData = [...prev.slice(1)];
        const lastTimeParts = newData[newData.length - 1].time.split(':');
        const totalMinutes = parseInt(lastTimeParts[0]) * 60 + parseInt(lastTimeParts[1]) + 1;
        const newTime = `${Math.floor(totalMinutes / 60)}:${(totalMinutes % 60).toString().padStart(2, '0')}`;
        
        const newPoint: any = { time: newTime };
        initialParameters.forEach(p => {
          const lastPoint = prev[prev.length - 1];
          const jitter = (Math.random() - 0.5) * p.variance * 0.3;
          let newVal = lastPoint[p.name] + jitter;
          newPoint[p.name] = parseFloat(newVal.toFixed(2));
          newPoint[`golden_${p.name}`] = lastPoint[`golden_${p.name}`];
        });
        return [...newData, newPoint];
      });

      setLiveParameters(prev => prev.map(p => {
        const jitter = (Math.random() - 0.5) * p.variance * 0.3;
        let newVal = p.current + jitter;
        return { ...p, current: parseFloat(newVal.toFixed(2)) };
      }));
      setLastUpdated(new Date().toLocaleTimeString());
    }, 2500);

    return () => clearInterval(interval);
  }, [initialParameters, initialTrendData]);

  const [activeParamName, setActiveParamName] = useState(liveParameters[0]?.name || '');

  // Reset active param if the batch changes and the new batch doesn't have the old active param
  useMemo(() => {
    if (liveParameters.length > 0 && !liveParameters.find(p => p.name === activeParamName)) {
      setActiveParamName(liveParameters[0].name);
    }
  }, [liveParameters, activeParamName]);

  const activeParamObj = liveParameters.find(p => p.name === activeParamName) || liveParameters[0];

  // Calculate generic statistics
  const stats = useMemo(() => {
    if (!activeParamObj || liveTrendData.length === 0) return { avg: 0, min: 0, max: 0, variance: 0, stdDev: 0 };

    let sum = 0;
    let min = Infinity;
    let max = -Infinity;

    liveTrendData.forEach(d => {
      const val = d[activeParamName] as number;
      if (val !== undefined) {
        sum += val;
        if (val < min) min = val;
        if (val > max) max = val;
      }
    });

    const count = liveTrendData.length;
    const avg = sum / count;

    let sqSum = 0;
    liveTrendData.forEach(d => {
      const val = d[activeParamName] as number;
      if (val !== undefined) sqSum += Math.pow(val - avg, 2);
    });

    const variance = sqSum / count;
    const stdDev = Math.sqrt(variance);

    const format = (num: number) => {
      // Find the scale based on the original param unit/scale layout indirectly using standard rules
      return parseFloat(num.toFixed(activeParamObj.current % 1 === 0 ? 0 : 2));
    };

    return {
      avg: format(avg),
      min: format(min === Infinity ? 0 : min),
      max: format(max === -Infinity ? 0 : max),
      variance: format(variance),
      stdDev: format(stdDev)
    };
  }, [activeParamName, liveTrendData, activeParamObj]);

  const getAiMessage = () => {
    if (!activeParamObj) return '';
    const diff = (activeParamObj.current - activeParamObj.golden).toFixed(2);
    if (activeParamObj.status === 'normal') {
      return `${activeParamName} is operating normally with a stable deviation of ${diff > '0' ? '+' : ''}${diff} ${activeParamObj.unit}. The current trend closely aligns with the Golden Batch profile.`;
    } else if (activeParamObj.status === 'warning') {
      return `${activeParamName} has an active warning (Deviation: ${diff > '0' ? '+' : ''}${diff} ${activeParamObj.unit}). The parameter is drifting toward the control limits. Close observation is recommended.`;
    } else {
      return `Critical deviation detected in ${activeParamName} (${diff > '0' ? '+' : ''}${diff} ${activeParamObj.unit}). Process has exceeded expected bounds. Corrective action required immediately.`;
    }
  };

  if (!activeParamObj) return null;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Live Process Monitoring</h1>
          <div className="flex items-center gap-2 mt-1">
             <p className="text-sm text-gray-500">Real-time parameters and control charting for</p>
             <select
               value={localBatch}
               onChange={(e) => setLocalBatch(e.target.value)}
               className="bg-gray-50 border border-gray-200 text-sm text-gray-700 rounded font-medium px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
             >
               {runningBatches.length > 0 ? (
                 runningBatches.map(b => <option key={b} value={b}>{b}</option>)
               ) : (
                 <option value={localBatch}>{localBatch}</option>
               )}
             </select>
             <p className="text-sm text-gray-500">at {selectedPlant}</p>
          </div>
          <p className="text-xs text-gray-400 mt-1 flex items-center font-medium"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse"></span> Last Updated: {lastUpdated}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {liveParameters.map((param) => {
          const dev = param.current - param.golden;
          return (
            <div key={param.name} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 relative overflow-hidden">
              <div className="flex justify-between items-start mb-4">
                <span className="text-sm font-medium text-gray-500">{param.name}</span>
                <span className={`w-3 h-3 rounded-full ${param.status === 'normal' ? 'bg-green-500' : param.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'}`}></span>
              </div>
              <div className="text-2xl font-bold text-gray-900 mb-1">{param.current} {param.unit}</div>
              <div className="text-sm text-gray-500 flex justify-between">
                <span>Golden: {param.golden}</span>
                <span className={`font-medium ${dev > 0 ? 'text-rose-600' : dev < 0 ? 'text-indigo-600' : 'text-gray-600'}`}>
                  Dev: {dev > 0 ? '+' : ''}{dev.toFixed(2)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-semibold text-gray-800">Parameter Trend Comparison</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Parameter:</span>
                <select
                  value={activeParamName}
                  onChange={(e) => setActiveParamName(e.target.value)}
                  className="bg-gray-50 border border-gray-200 text-sm text-gray-800 rounded-md py-1.5 px-3 outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                >
                  {liveParameters.map(p => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="h-80 w-full relative">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={liveTrendData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} tickMargin={10} minTickGap={20} />
                  <YAxis
                    domain={['dataMin - ' + (activeParamObj.upperLimit - activeParamObj.lowerLimit) * 0.2, 'dataMax + ' + (activeParamObj.upperLimit - activeParamObj.lowerLimit) * 0.2]}
                    stroke="#6b7280"
                    fontSize={12}
                    tickFormatter={(val) => typeof val === 'number' ? val.toFixed(1) : val}
                  />
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px', paddingBottom: '10px' }} />
                  <ReferenceArea
                    y1={activeParamObj.lowerLimit}
                    y2={activeParamObj.upperLimit}
                    fill="#10b981"
                    fillOpacity={0.08}
                  />
                  <Line
                    type="monotone"
                    dataKey={activeParamName}
                    name={`Current ${activeParamName}`}
                    stroke="#3b82f6"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey={`golden_${activeParamName}`}
                    name={`Golden ${activeParamName}`}
                    stroke="#eab308"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 flex flex-col">
            <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wider mb-4 border-b border-gray-100 pb-2 flex items-center gap-2">
              <Info size={16} className="text-blue-500" /> {activeParamName} Statistics (Last 60m)
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-gray-50 border border-gray-100 p-3 rounded-lg flex flex-col items-center justify-center">
                <span className="text-xs text-gray-500 mb-1">Average</span>
                <span className="font-semibold text-gray-900">{stats.avg}</span>
              </div>
              <div className="bg-gray-50 border border-gray-100 p-3 rounded-lg flex flex-col items-center justify-center">
                <span className="text-xs text-gray-500 mb-1">Std Dev</span>
                <span className="font-semibold text-gray-900">{stats.stdDev}</span>
              </div>
              <div className="bg-gray-50 border border-gray-100 p-3 rounded-lg flex flex-col items-center justify-center">
                <span className="text-xs text-gray-500 mb-1">Variance</span>
                <span className="font-semibold text-gray-900">{stats.variance}</span>
              </div>
              <div className="bg-gray-50 border border-gray-100 p-3 rounded-lg flex flex-col items-center justify-center">
                <span className="text-xs text-gray-500 mb-1">Minimum</span>
                <span className="font-semibold text-gray-900">{stats.min}</span>
              </div>
              <div className="bg-gray-50 border border-gray-100 p-3 rounded-lg flex flex-col items-center justify-center">
                <span className="text-xs text-gray-500 mb-1">Maximum</span>
                <span className="font-semibold text-gray-900">{stats.max}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-blue-50/50 rounded-lg shadow-sm border border-blue-100 p-6 h-fit">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <BrainCircuit className="text-blue-600" /> AI Observation
          </h2>
          <div className={`p-4 rounded-xl border ${activeParamObj.status === 'normal' ? 'bg-white border-gray-200 text-gray-700' : activeParamObj.status === 'warning' ? 'bg-yellow-50 border-yellow-200 text-yellow-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
            <p className="text-sm leading-relaxed font-medium">
              {getAiMessage()}
            </p>
            <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-widest pt-4 border-t border-gray-100/30">
              Target Operating Band:
              <span className="bg-white/50 px-2 py-0.5 rounded border border-gray-200/50">
                {activeParamObj.lowerLimit} - {activeParamObj.upperLimit} {activeParamObj.unit}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
