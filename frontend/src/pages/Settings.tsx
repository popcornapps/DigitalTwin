// Settings - lets you create new simulated running batches (for testing
// Process Monitoring / KPI Prediction & Deviation against a fresh scenario)
// and stop existing ones. Both those pages read from the same single list
// of running batches (GET /api/live-batches) - this page manages that same
// list, it doesn't have its own separate batch data.
import { useEffect, useState } from 'react';
import { Loader2, Play, Plus, Square } from 'lucide-react';
import { createRunningBatch, fetchRunningBatches, stopRunningBatch } from '../lib/api';
import type { RunningBatchSummary } from '../lib/api';
import { PLANTS } from '../context/FilterContext';

const SCENARIO_PROFILES: Array<'Normal' | 'Warning' | 'Critical'> = ['Normal', 'Warning', 'Critical'];

const DRIFTING_PARAMETERS = [
  { value: '', label: 'Auto (default parameter)' },
  { value: 'temperature', label: 'Temperature' },
  { value: 'process_pressure', label: 'Process Pressure' },
  { value: 'flow_rate', label: 'Flow Rate' },
  { value: 'agitator_rpm', label: 'Agitator RPM' },
  { value: 'inlet_air_humidity', label: 'Inlet Air Humidity' },
  { value: 'exhaust_air_temp', label: 'Exhaust Air Temperature' },
  { value: 'filter_differential_pressure', label: 'Filter Differential Pressure' },
  { value: 'shaker_vibration_frequency', label: 'Shaker Vibration Frequency' },
  { value: 'product_bed_temp', label: 'Product Bed Temperature' },
  { value: 'chamber_differential_pressure', label: 'Chamber Differential Pressure' },
  { value: 'ahu_damper_position', label: 'AHU Damper Position' },
  { value: 'compressed_air_pressure', label: 'Compressed Air Pressure' },
];

const STATUS_BADGE: Record<string, string> = {
  Running: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Completed: 'bg-gray-100 text-gray-600 border-gray-200',
  Stopped: 'bg-gray-100 text-gray-600 border-gray-200',
};

export default function Settings() {
  const [runningBatches, setRunningBatches] = useState<RunningBatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [plant, setPlant] = useState(PLANTS[0]);
  const [scenarioProfile, setScenarioProfile] = useState<'Normal' | 'Warning' | 'Critical'>('Normal');
  const [driftingParameter, setDriftingParameter] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  const loadBatches = () => {
    fetchRunningBatches()
      .then((data) => {
        // Completed/Stopped batches already have a proper home in Batch
        // Explorer - this page's job is managing what's currently running,
        // so anything else here is dead weight with no Stop button anyway.
        setRunningBatches(data.filter((b) => b.status === 'Running'));
        setListError(null);
      })
      .catch((err) => setListError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadBatches();
    const interval = setInterval(loadBatches, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleCreate = () => {
    setCreating(true);
    setCreateError(null);
    createRunningBatch(plant, scenarioProfile, scenarioProfile === 'Normal' ? null : driftingParameter || null)
      .then(() => {
        loadBatches();
        setDriftingParameter('');
      })
      .catch((err) => setCreateError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCreating(false));
  };

  const handleStop = (runningBatchId: string) => {
    setStoppingId(runningBatchId);
    stopRunningBatch(runningBatchId)
      .then(() => loadBatches())
      .finally(() => setStoppingId(null));
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Create or stop running batches, used by Process Monitoring and KPI Prediction & Deviation.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-sm font-bold text-gray-700 flex items-center gap-2">
          <Plus size={16} className="text-blue-600" /> Create a Running Batch
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Plant</label>
            <select
              value={plant}
              onChange={(e) => setPlant(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 text-sm text-gray-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {PLANTS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Scenario Profile</label>
            <select
              value={scenarioProfile}
              onChange={(e) => setScenarioProfile(e.target.value as 'Normal' | 'Warning' | 'Critical')}
              className="w-full bg-gray-50 border border-gray-200 text-sm text-gray-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {SCENARIO_PROFILES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Drifting Parameter</label>
            <select
              value={driftingParameter}
              onChange={(e) => setDriftingParameter(e.target.value)}
              disabled={scenarioProfile === 'Normal'}
              className="w-full bg-gray-50 border border-gray-200 text-sm text-gray-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {DRIFTING_PARAMETERS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>
        </div>

        {createError && <p className="text-xs text-red-600">{createError}</p>}

        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-wait"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          Create Batch
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-4">Running Batches</h2>

        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : listError ? (
          <p className="text-sm text-red-600">{listError}</p>
        ) : runningBatches.length === 0 ? (
          <p className="text-sm text-gray-500">No running batches right now.</p>
        ) : (
          <div className="space-y-2">
            {runningBatches.map((b) => (
              <div key={b.running_batch_id} className="flex items-center justify-between flex-wrap gap-y-2 border border-gray-100 rounded-lg px-4 py-3">
                <div className="flex items-center gap-3 flex-wrap min-w-0">
                  <span className="text-sm font-semibold text-gray-800 truncate max-w-[10rem]">{b.running_batch_id}</span>
                  <span className={`px-2 py-0.5 rounded-full text-2xs font-bold border shrink-0 ${STATUS_BADGE[b.status] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                    {b.status}
                  </span>
                  <span className="text-xs text-gray-500 truncate max-w-[12rem]">{b.scenario_profile}{b.drifting_parameter ? ` · ${b.drifting_parameter}` : ''}</span>
                  <span className="text-xs text-gray-400 shrink-0">{b.elapsed_minutes} / {b.target_duration_minutes} min</span>
                </div>
                {b.status === 'Running' && (
                  <button
                    onClick={() => handleStop(b.running_batch_id)}
                    disabled={stoppingId === b.running_batch_id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50 shrink-0"
                  >
                    <Square size={12} /> Stop
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
