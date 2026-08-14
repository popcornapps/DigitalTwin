import { createPortal } from 'react-dom';
import { XCircle } from 'lucide-react';
import type { KPIDefinition } from '../lib/kpiDefinitions';

interface KPIInfoModalProps {
  kpiDefinition: KPIDefinition;
  currentValue?: string;
  // Real per-batch calculation, built by buildCurrentCalculation() - takes
  // priority over kpiDefinition.exampleCalculation whenever a batch is selected,
  // so this shows this batch's actual numbers instead of a generic example.
  currentCalculation?: KPIDefinition['exampleCalculation'];
  // Plant Manager dashboard cards are plant-wide rollups (averages/sums
  // across every batch), not a standard per-batch KPI formula someone would
  // need to audit - hidden there to avoid implying it's an industry-standard
  // calculation. Batch Explorer/Golden Batch still show it.
  hideFormula?: boolean;
  // Dashboard period cards (This Month/Today/Current Shift) are an average
  // across many batches, not a per-batch definition/benchmark someone needs
  // - only the calculation box (which batches, what the average came out to)
  // is relevant there, so this skips the definition paragraph and benchmark
  // section entirely, showing just that one box.
  minimal?: boolean;
  onClose: () => void;
}

export function KPIInfoModal({ kpiDefinition, currentValue, currentCalculation, hideFormula, minimal, onClose }: KPIInfoModalProps) {
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

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-white/70 backdrop-blur-[2px]" onClick={onClose}>
      <div className={`bg-white rounded-2xl border border-gray-200 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)] relative w-full flex flex-col overflow-hidden pointer-events-auto animate-fade-in-content ring-1 ring-black/5 ${minimal ? 'max-w-xs' : 'max-w-xl max-h-[85vh]'}`} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className={`border-b border-gray-100 flex justify-between items-start bg-gray-50 shrink-0 ${minimal ? 'px-4 py-3' : 'px-5 py-4'}`}>
          <div className="flex-1 min-w-0">
            {!minimal && (
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className={`inline-flex px-2.5 py-0.5 rounded-full text-2xs font-bold uppercase tracking-wider border ${getCategoryColor(kpiDefinition.category)}`}>
                  {kpiDefinition.category}
                </span>
                {currentValue && (
                  <span className="inline-flex px-2.5 py-0.5 rounded-full text-2xs font-bold bg-gray-900 text-white">
                    Current: {currentValue}
                  </span>
                )}
              </div>
            )}
            <h2 className={`font-bold text-gray-900 leading-tight ${minimal ? 'text-sm' : 'text-lg'}`}>{kpiDefinition.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors ml-3 shrink-0"
          >
            <XCircle size={minimal ? 16 : 18} />
          </button>
        </div>

        {/* Content */}
        <div className={`overflow-y-auto flex-1 text-sm ${minimal ? 'p-3' : 'p-5 space-y-4'}`}>

          {/* 1. What is it */}
          {!minimal && <p className="text-gray-700 leading-relaxed">{kpiDefinition.definition}</p>}

          {/* 2. Formula */}
          {!hideFormula && !minimal && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
              <h3 className="text-2xs font-bold text-indigo-600 uppercase tracking-widest mb-1.5">Formula</h3>
              <code className="text-sm font-mono font-semibold text-indigo-900 block">{kpiDefinition.formula}</code>
            </div>
          )}

          {/* 3. Current Batch Calculation (falls back to a generic example if no batch is selected).
              minimal skips the inputs breakdown - just the calculation sentence and its result. */}
          <div className={`bg-slate-50 border border-slate-200 rounded-lg ${minimal ? 'p-2.5' : 'p-3'}`}>
            {!minimal && <h3 className="text-2xs font-bold text-slate-500 uppercase tracking-widest mb-2">{calcLabel}</h3>}
            {!minimal && (
              <div className="space-y-1 mb-2">
                {calc.inputs.map((input, idx) => (
                  <div key={idx} className="flex justify-between gap-3 text-xs">
                    <span className="text-slate-500">{input.label}</span>
                    <span className="font-semibold text-slate-800 text-right">{input.value}</span>
                  </div>
                ))}
              </div>
            )}
            <code className={`font-mono text-slate-600 block ${minimal ? 'text-2xs mb-1.5' : 'text-xs mb-2'}`}>{calc.calculation}</code>
            <div className={`bg-emerald-500 text-white rounded-md text-center font-bold ${minimal ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'}`}>
              {calc.result}
            </div>
          </div>

          {/* 4. Industry Benchmark */}
          {!minimal && (
            <div className="bg-purple-50 border border-purple-100 rounded-lg p-3">
              <h3 className="text-2xs font-bold text-purple-600 uppercase tracking-widest mb-1">Industry Benchmark</h3>
              <p className="text-sm font-semibold text-gray-900">{kpiDefinition.benchmarkRange}</p>
            </div>
          )}

        </div>

        {/* Footer - skipped in minimal mode, the X button is enough for a one-box popup */}
        {!minimal && (
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 shrink-0 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors"
            >
              Close
            </button>
          </div>
        )}

      </div>
    </div>,
    document.body
  );
}
