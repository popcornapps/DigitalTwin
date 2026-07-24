import { XCircle } from 'lucide-react';
import type { KPIDefinition } from '../lib/kpiDefinitions';

interface KPIInfoModalProps {
  kpiDefinition: KPIDefinition;
  currentValue?: string;
  // Real per-batch calculation, built by buildCurrentCalculation() - takes
  // priority over kpiDefinition.exampleCalculation whenever a batch is selected,
  // so this shows this batch's actual numbers instead of a generic example.
  currentCalculation?: KPIDefinition['exampleCalculation'];
  onClose: () => void;
}

export function KPIInfoModal({ kpiDefinition, currentValue, currentCalculation, onClose }: KPIInfoModalProps) {
  const getCategoryColor = (category: KPIDefinition['category']) => {
    switch (category) {
      case 'efficiency': return 'text-indigo-600 bg-indigo-50 border-indigo-200';
      case 'quality': return 'text-rose-600 bg-rose-50 border-rose-200';
      case 'performance': return 'text-emerald-600 bg-emerald-50 border-emerald-200';
      case 'energy': return 'text-orange-600 bg-orange-50 border-orange-200';
      case 'similarity': return 'text-teal-600 bg-teal-50 border-teal-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const calc = currentCalculation ?? kpiDefinition.exampleCalculation;
  const calcLabel = currentCalculation ? 'Current Batch Calculation' : 'Example Calculation';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 pointer-events-none bg-white/70 backdrop-blur-[2px]">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)] relative w-full max-w-xl flex flex-col max-h-[85vh] overflow-hidden pointer-events-auto animate-fade-in-content ring-1 ring-black/5">

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-start bg-gray-50 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${getCategoryColor(kpiDefinition.category)}`}>
                {kpiDefinition.category}
              </span>
              {currentValue && (
                <span className="inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gray-900 text-white">
                  Current: {currentValue}
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-gray-900 leading-tight">{kpiDefinition.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors ml-3 shrink-0"
          >
            <XCircle size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4 text-sm">

          {/* 1. What is it */}
          <p className="text-gray-700 leading-relaxed">{kpiDefinition.definition}</p>

          {/* 2. Formula */}
          <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
            <h3 className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest mb-1.5">Formula</h3>
            <code className="text-sm font-mono font-semibold text-indigo-900 block">{kpiDefinition.formula}</code>
          </div>

          {/* 3. Current Batch Calculation (falls back to a generic example if no batch is selected) */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">{calcLabel}</h3>
            <div className="space-y-1 mb-2">
              {calc.inputs.map((input, idx) => (
                <div key={idx} className="flex justify-between gap-3 text-xs">
                  <span className="text-slate-500">{input.label}</span>
                  <span className="font-semibold text-slate-800 text-right">{input.value}</span>
                </div>
              ))}
            </div>
            <code className="text-xs font-mono text-slate-600 block mb-2">{calc.calculation}</code>
            <div className="bg-emerald-500 text-white rounded-md px-3 py-1.5 text-sm font-bold text-center">
              {calc.result}
            </div>
          </div>

          {/* 4. Industry Benchmark */}
          <div className="bg-purple-50 border border-purple-100 rounded-lg p-3">
            <h3 className="text-[10px] font-bold text-purple-600 uppercase tracking-widest mb-1">Industry Benchmark</h3>
            <p className="text-sm font-semibold text-gray-900">{kpiDefinition.benchmarkRange}</p>
          </div>

          {/* 5. Key Influencing Factors */}
          <div>
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Key Influencing Factors</h3>
            <ul className="space-y-1">
              {kpiDefinition.influencingParameters.map((factor, idx) => (
                <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                  <span className="text-gray-400 mt-0.5">•</span>
                  <span>{factor}</span>
                </li>
              ))}
            </ul>
          </div>

        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
