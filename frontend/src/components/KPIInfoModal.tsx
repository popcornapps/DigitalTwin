import { XCircle, TrendingUp, TrendingDown, Target, Zap, Info, AlertCircle, BookOpen } from 'lucide-react';
import type { KPIDefinition } from '../lib/kpiDefinitions';

interface KPIInfoModalProps {
  kpiDefinition: KPIDefinition;
  currentValue?: string;
  onClose: () => void;
}

export function KPIInfoModal({ kpiDefinition, currentValue, onClose }: KPIInfoModalProps) {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 pointer-events-none bg-white/70 backdrop-blur-[2px]">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)] relative w-full max-w-4xl flex flex-col max-h-[90vh] overflow-hidden pointer-events-auto animate-fade-in-content ring-1 ring-black/5">

        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-start bg-gradient-to-r from-gray-50 to-white shrink-0">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${getCategoryColor(kpiDefinition.category)}`}>
                {kpiDefinition.category}
              </span>
              {currentValue && (
                <span className="inline-flex px-3 py-1 rounded-full text-xs font-bold bg-gray-900 text-white">
                  Current: {currentValue}
                </span>
              )}
            </div>
            <h2 className="text-2xl font-black text-gray-900 leading-tight flex items-center gap-2">
              <BookOpen size={24} className="text-indigo-500" />
              {kpiDefinition.name}
            </h2>
            <p className="text-sm text-gray-500 mt-1 font-medium">Educational Reference • PharmaTwin Digital Twin</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors ml-4"
          >
            <XCircle size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">

          {/* Definition & Importance */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Info size={16} className="text-blue-600" />
                <h3 className="text-xs font-bold text-blue-600 uppercase tracking-widest">What It Is</h3>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{kpiDefinition.definition}</p>
            </div>

            <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Target size={16} className="text-amber-600" />
                <h3 className="text-xs font-bold text-amber-600 uppercase tracking-widest">Why It Matters</h3>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{kpiDefinition.importance}</p>
            </div>
          </div>

          {/* Formula */}
          <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-5">
            <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-3 flex items-center gap-2">
              <Zap size={16} />
              Calculation Formula
            </h3>
            <div className="bg-white rounded-lg p-4 border border-indigo-100">
              <code className="text-base font-mono font-bold text-indigo-900 block text-center">
                {kpiDefinition.formula}
              </code>
            </div>
          </div>

          {/* Example Calculation */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
            <h3 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-3">Example Calculation</h3>
            <div className="space-y-3">
              {kpiDefinition.exampleCalculation.inputs.map((input, idx) => (
                <div key={idx} className="flex items-start gap-3 text-sm">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <div className="flex-1">
                    <span className="font-bold text-slate-900">{input.label}:</span>
                    <span className="text-slate-600 ml-2">{input.value}</span>
                  </div>
                </div>
              ))}
              <div className="bg-white rounded-lg p-3 border border-slate-300 mt-4">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Calculation:</div>
                <code className="text-sm font-mono text-slate-900">{kpiDefinition.exampleCalculation.calculation}</code>
              </div>
              <div className="bg-emerald-500 text-white rounded-lg p-3 font-bold text-center">
                Result: {kpiDefinition.exampleCalculation.result}
              </div>
            </div>
          </div>

          {/* Factors Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Increasing Factors */}
            <div className="bg-emerald-50/50 border border-emerald-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={18} className="text-emerald-600" />
                <h3 className="text-xs font-bold text-emerald-600 uppercase tracking-widest">What Increases It</h3>
              </div>
              <ul className="space-y-2">
                {kpiDefinition.increasingFactors.map((factor, idx) => (
                  <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                    <span className="text-emerald-500 font-bold mt-0.5">↑</span>
                    <span>{factor}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Decreasing Factors */}
            <div className="bg-rose-50/50 border border-rose-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingDown size={18} className="text-rose-600" />
                <h3 className="text-xs font-bold text-rose-600 uppercase tracking-widest">What Decreases It</h3>
              </div>
              <ul className="space-y-2">
                {kpiDefinition.decreasingFactors.map((factor, idx) => (
                  <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                    <span className="text-rose-500 font-bold mt-0.5">↓</span>
                    <span>{factor}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Benchmark Range */}
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Target size={16} className="text-purple-600" />
              <h3 className="text-xs font-bold text-purple-600 uppercase tracking-widest">Industry Benchmark</h3>
            </div>
            <p className="text-sm font-bold text-gray-900">{kpiDefinition.benchmarkRange}</p>
          </div>

          {/* Influencing Parameters */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <h3 className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-3">Process Parameters That Influence This KPI</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {kpiDefinition.influencingParameters.map((param, idx) => (
                <div key={idx} className="bg-white rounded-lg px-3 py-2 border border-blue-100 text-sm text-gray-700 font-medium">
                  • {param}
                </div>
              ))}
            </div>
          </div>

          {/* Digital Twin Note */}
          <div className="bg-gradient-to-r from-cyan-50 to-blue-50 border-2 border-cyan-200 rounded-xl p-5">
            <div className="flex items-start gap-3 mb-3">
              <AlertCircle size={20} className="text-cyan-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-xs font-bold text-cyan-600 uppercase tracking-widest">Future: Real Digital Twin Implementation</h3>
                <p className="text-xs text-cyan-600 font-semibold mt-1">How this KPI would be calculated from live manufacturing data</p>
              </div>
            </div>
            <p className="text-sm text-gray-700 leading-relaxed">
              {kpiDefinition.digitalTwinNote}
            </p>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 shrink-0">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              <strong>Current Implementation:</strong> Mock/simulated data for demonstration purposes
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
