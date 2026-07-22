import { BrainCircuit, Info, Clock } from 'lucide-react';
import { deviationPredictionSnapshot } from '../lib/deviationPredictionSnapshot';

const ALERT_STYLES: Record<string, { badge: string; card: string; dot: string; text: string }> = {
  Normal: { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', card: 'border-gray-200', dot: 'bg-green-500', text: 'text-emerald-600' },
  Warning: { badge: 'bg-amber-50 text-amber-700 border-amber-200', card: 'border-amber-300 ring-1 ring-amber-100', dot: 'bg-yellow-500', text: 'text-amber-600' },
  Critical: { badge: 'bg-red-50 text-red-700 border-red-200', card: 'border-red-300 ring-1 ring-red-100', dot: 'bg-red-500', text: 'text-red-600' },
  'Not Applicable': { badge: 'bg-gray-50 text-gray-500 border-gray-200', card: 'border-gray-200', dot: 'bg-gray-300', text: 'text-gray-500' },
};

export default function DeviationPrediction() {
  const snapshot = deviationPredictionSnapshot;
  const activeLevels = snapshot.parameters.filter((p) => p.applicable).map((p) => p.alertLevel);
  const overallStatus = activeLevels.includes('Critical') ? 'Critical' : activeLevels.includes('Warning') ? 'Warning' : 'Normal';
  const overallStyle = ALERT_STYLES[overallStatus];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BrainCircuit className="h-6 w-6 text-indigo-600" /> Process Parameter Deviation Prediction
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            30-minute-ahead forecast from the trained Random Forest model, evaluated against Golden Batch operating limits
          </p>
        </div>
        <div className="text-right">
          <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Batch</span>
          <span className="text-sm font-bold text-slate-800 font-mono">{snapshot.batchId}</span>
        </div>
      </div>

      <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 flex items-start gap-3">
        <Info size={18} className="text-indigo-500 mt-0.5 shrink-0" />
        <p className="text-xs text-indigo-900 leading-relaxed">
          <strong>Prototype view.</strong> This is a real snapshot from the trained model run against actual generated batch data, not a live feed —
          batch <strong>{snapshot.batchId}</strong> at minute <strong>{snapshot.elapsedMinutes}</strong> of {snapshot.batchDurationMinutes}.
          For validation context, this historical batch's recorded outcome was{' '}
          <strong>{snapshot.groundTruthScenario.replace(/_/g, ' ')}</strong> ({snapshot.groundTruthSeverity} severity).
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Plant / Product</span>
          <div className="text-sm font-bold text-gray-900 mt-1">{snapshot.plant}</div>
          <div className="text-xs text-gray-500">{snapshot.product}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
            <Clock size={12} /> Elapsed / Duration
          </span>
          <div className="text-sm font-bold text-gray-900 mt-1">{snapshot.elapsedMinutes} / {snapshot.batchDurationMinutes} min</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Prediction Horizon</span>
          <div className="text-sm font-bold text-gray-900 mt-1">+{snapshot.horizonMinutes} minutes</div>
        </div>
        <div className={`bg-white rounded-xl border shadow-sm p-4 ${overallStyle.card}`}>
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Overall Batch Status</span>
          <div className={`text-sm font-bold mt-1 ${overallStyle.text}`}>{overallStatus}</div>
        </div>
      </div>

      <div>
        <h3 className="text-base font-bold text-gray-800 uppercase tracking-wider pl-1 mb-3">Parameter Forecast</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {snapshot.parameters.map((p) => {
            const style = ALERT_STYLES[p.alertLevel];
            return (
              <div key={p.key} className={`bg-white rounded-xl shadow-sm border p-5 flex flex-col justify-between ${style.card}`}>
                <div className="flex justify-between items-start mb-3">
                  <span className="text-sm font-semibold text-gray-700">{p.label}</span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${style.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`}></span>
                    {p.alertLevel}
                  </span>
                </div>

                <div className="space-y-2.5">
                  <div className="flex justify-between items-baseline">
                    <span className="text-[10px] text-gray-400 uppercase font-semibold">Current</span>
                    <span className="text-lg font-bold text-gray-900">{p.current} {p.unit}</span>
                  </div>

                  {p.applicable ? (
                    <>
                      <div className="flex justify-between items-baseline">
                        <span className="text-[10px] text-gray-400 uppercase font-semibold">Predicted (+30m)</span>
                        <span className="text-base font-bold text-indigo-600">{p.predicted30Min} {p.unit}</span>
                      </div>
                      <div className="flex justify-between items-baseline">
                        <span className="text-[10px] text-gray-400 uppercase font-semibold">90% Confidence</span>
                        <span className="text-xs font-mono text-gray-600">{p.ciLow} – {p.ciHigh}</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-[11px] text-gray-400 italic pt-1">
                      Idle during drying — not covered by deviation prediction in this phase.
                    </p>
                  )}

                  <div className="pt-2 border-t border-gray-100 flex justify-between items-center">
                    <span className="text-[10px] text-gray-400 uppercase font-semibold">Golden Limit</span>
                    <span className="text-[11px] font-mono text-gray-500">{p.lowerLimit} – {p.upperLimit} {p.unit}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
