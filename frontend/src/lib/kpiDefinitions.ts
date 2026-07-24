// KPI reference content for PharmaTwin Digital Twin
// Central source of truth for KPI metadata shown in the compact KPI info modal.

import type { BatchKPIs } from './api';

export interface KPIDefinition {
  id: string;
  name: string;
  shortName: string;
  definition: string;
  formula: string;
  exampleCalculation: {
    inputs: { label: string; value: string }[];
    calculation: string;
    result: string;
  };
  benchmarkRange: string;
  influencingParameters: string[];
  category: 'efficiency' | 'quality' | 'performance' | 'energy' | 'similarity';
}

export const KPI_DEFINITIONS: Record<string, KPIDefinition> = {
  oee: {
    id: 'oee',
    name: 'Overall Equipment Effectiveness (OEE)',
    shortName: 'OEE',
    definition: 'OEE combines Availability (uptime), Performance (speed), and Quality (good output) into a single manufacturing efficiency score. It\'s the industry-standard metric for spotting hidden capacity and productivity losses.',
    formula: 'OEE = Availability × Performance × Quality',
    exampleCalculation: {
      inputs: [
        { label: 'Availability', value: '95%' },
        { label: 'Performance', value: '91%' },
        { label: 'Quality', value: '97%' },
      ],
      calculation: 'OEE = 0.95 × 0.91 × 0.97',
      result: '83.9%',
    },
    benchmarkRange: 'World-class: 85%+, Good: 70-85%, Fair: 60-70%, Poor: <60%',
    influencingParameters: [
      'Equipment runtime vs. planned production time',
      'Actual throughput vs. ideal cycle time',
      'Good units produced vs. total units started',
      'Downtime events (breakdowns, changeovers, waiting)',
    ],
    category: 'efficiency',
  },

  yield: {
    id: 'yield',
    name: 'Batch Yield',
    shortName: 'Yield',
    definition: 'Yield is the percentage of theoretical output a batch actually produces. Lower yield means material waste, rework, or a process problem worth investigating.',
    formula: 'Yield = (Actual Output / Theoretical Output) × 100%',
    exampleCalculation: {
      inputs: [
        { label: 'Theoretical Output', value: '150 kg' },
        { label: 'Actual Output', value: '148.6 kg' },
      ],
      calculation: 'Yield = 148.6 / 150 × 100',
      result: '99.1%',
    },
    benchmarkRange: 'Pharmaceutical industry: 96-99.5% (high-value products target 99%+)',
    influencingParameters: [
      'Process stability during drying (Temperature/Pressure/Flow)',
      'Mixing and granulation control',
      'Equipment calibration (feeders, scales)',
      'Rejected or off-spec material',
    ],
    category: 'efficiency',
  },

  qualityScore: {
    id: 'qualityScore',
    name: 'Quality Score',
    shortName: 'Quality Score',
    definition: 'Quality Score summarizes how close a batch\'s Assay result sits to its label-claim target. It\'s the number that determines whether a batch is release-ready.',
    formula: 'Quality Score = 100 × (1 - |Assay % - Target| / 10)',
    exampleCalculation: {
      inputs: [
        { label: 'Assay', value: '99.6%' },
        { label: 'Target', value: '100.0%' },
      ],
      calculation: 'Quality Score = 100 × (1 - |99.6 - 100| / 10)',
      result: '96.0%',
    },
    benchmarkRange: 'Pharmaceutical release standard: >95% (typical 97-99.5%)',
    influencingParameters: [
      'Assay result vs. label-claim target',
      'Process stability during drying',
      'Temperature/Pressure/Flow excursions',
    ],
    category: 'quality',
  },

  assay: {
    id: 'assay',
    name: 'Assay %',
    shortName: 'Assay',
    definition: 'Assay is the measured potency of the active pharmaceutical ingredient (API), expressed as a percentage of labeled strength. It\'s a release-blocking Critical Quality Attribute - too little API and the medicine may not work, too much and it may be unsafe.',
    formula: 'Assay % = (Measured API Content / Labeled API Content) × 100%',
    exampleCalculation: {
      inputs: [
        { label: 'Labeled Strength', value: '100.0% (target)' },
        { label: 'Measured API Content', value: '99.6%' },
      ],
      calculation: 'Assay % = 99.6 / 100.0 × 100',
      result: '99.6%',
    },
    benchmarkRange: 'Pharmaceutical specification: 95-105% of label claim (target 100%)',
    influencingParameters: [
      'Drying temperature and duration',
      'Process pressure stability',
      'Flow rate consistency',
    ],
    category: 'quality',
  },

  processStability: {
    id: 'processStability',
    name: 'Process Stability',
    shortName: 'Process Stability',
    definition: 'Process Stability is the % of steady-state time Temperature, Pressure, and Flow Rate held within their control limits, averaged across the three. Higher stability means a more predictable, reproducible batch.',
    formula: 'Process Stability = Average(% time in control) across Temperature, Pressure, Flow Rate',
    exampleCalculation: {
      inputs: [
        { label: 'Temperature', value: '96.7% in control' },
        { label: 'Pressure', value: '100% in control' },
        { label: 'Flow Rate', value: '93.3% in control' },
      ],
      calculation: 'Average = (96.7 + 100 + 93.3) / 3',
      result: '96.7%',
    },
    benchmarkRange: 'Pharmaceutical process validation target: >95% (best-in-class: 98%+)',
    influencingParameters: [
      'Temperature control loop performance',
      'Pressure regulation accuracy',
      'Flow rate valve control',
      'Sensor drift or calibration errors',
    ],
    category: 'performance',
  },

  cycleTime: {
    id: 'cycleTime',
    name: 'Cycle Time / Batch Duration',
    shortName: 'Cycle Time',
    definition: 'Cycle Time is the total elapsed time from batch start to completion. Shorter cycle time (without sacrificing quality) means more throughput and lower cost per batch.',
    formula: 'Cycle Time = Batch End Time - Batch Start Time',
    exampleCalculation: {
      inputs: [
        { label: 'Batch Duration', value: '400 minutes' },
      ],
      calculation: 'Cycle Time = 400 / 60',
      result: '6.67 hrs',
    },
    benchmarkRange: 'Varies by product: Tablets 8-16 hrs, Capsules 10-20 hrs, Sterile products 24-72 hrs',
    influencingParameters: [
      'Drying temperature and duration',
      'Equipment downtime or breakdowns',
      'Process deviations requiring investigation',
    ],
    category: 'performance',
  },

  sec: {
    id: 'sec',
    name: 'Specific Energy Consumption (SEC)',
    shortName: 'SEC',
    definition: 'SEC is the energy consumed per kilogram of finished product. It\'s the key efficiency metric for both operating cost and sustainability reporting.',
    formula: 'SEC = Total Energy Consumed (kWh) / Actual Output (kg)',
    exampleCalculation: {
      inputs: [
        { label: 'Total Energy', value: '240 kWh' },
        { label: 'Actual Output', value: '150 kg' },
      ],
      calculation: 'SEC = 240 / 150',
      result: '1.6 kWh/kg',
    },
    benchmarkRange: 'Pharmaceutical manufacturing: 0.8-2.5 kWh/kg (depends on product complexity)',
    influencingParameters: [
      'Drying temperature and duration (major energy consumer)',
      'Batch duration',
      'Process instability (drives corrective energy use)',
    ],
    category: 'energy',
  },

  plantPerformance: {
    id: 'plantPerformance',
    name: 'Plant Performance',
    shortName: 'Plant Performance',
    definition: 'Plant Performance is a rollup score combining OEE, Quality Score, and Process Stability across a plant\'s batches. It gives leadership one number to gauge overall facility health.',
    formula: 'Plant Performance = Average(OEE, Quality Score, Process Stability)',
    exampleCalculation: {
      inputs: [
        { label: 'Average OEE', value: '90%' },
        { label: 'Average Quality Score', value: '96%' },
        { label: 'Average Process Stability', value: '94%' },
      ],
      calculation: 'Plant Performance = (90 + 96 + 94) / 3',
      result: '93.3%',
    },
    benchmarkRange: 'Best-in-class plants: 90%+, Average: 75-85%, Needs improvement: <70%',
    influencingParameters: [
      'Individual batch OEE performance',
      'Batch quality outcomes across the plant',
      'Process stability consistency across batches',
    ],
    category: 'performance',
  },

  goldenBatchSimilarity: {
    id: 'goldenBatchSimilarity',
    name: 'Golden Batch Similarity',
    shortName: 'Similarity',
    definition: 'Golden Batch Similarity measures how closely a batch\'s process trajectory tracks the ideal Golden Batch reference. Higher similarity means the batch followed proven, validated conditions.',
    formula: 'Similarity = 100 × (1 - Mean Deviation from Golden Batch / Control Band Width), averaged across parameters',
    exampleCalculation: {
      inputs: [
        { label: 'Temperature Match', value: '97%' },
        { label: 'Pressure Match', value: '95%' },
        { label: 'Flow Rate Match', value: '94%' },
      ],
      calculation: 'Average similarity = (97 + 95 + 94) / 3',
      result: '95.3%',
    },
    benchmarkRange: 'Target: >95% similarity for validated processes, >90% acceptable, <85% investigate',
    influencingParameters: [
      'Process parameter trajectories vs. Golden Batch',
      'Raw material and equipment consistency',
      'Operator adherence to setpoints',
    ],
    category: 'similarity',
  },
};

// Builds the "Current Batch Calculation" block from a real BatchKPIs row - used
// in place of the static exampleCalculation above whenever a batch is selected,
// so the modal shows this batch's actual numbers instead of a generic example.
export function buildCurrentCalculation(
  kpiId: string,
  kpis: BatchKPIs,
): KPIDefinition['exampleCalculation'] | undefined {
  switch (kpiId) {
    case 'yield':
      return {
        inputs: [
          { label: 'Theoretical Output', value: `${kpis.theoretical_output_kg.toFixed(0)} kg` },
          { label: 'Actual Output', value: `${kpis.actual_output_kg.toFixed(1)} kg` },
        ],
        calculation: `Yield = ${kpis.actual_output_kg.toFixed(1)} / ${kpis.theoretical_output_kg.toFixed(0)} × 100`,
        result: `${kpis.yield_pct.toFixed(1)}%`,
      };
    case 'assay':
      return {
        inputs: [
          { label: 'Target (Label Claim)', value: '100.0%' },
          { label: 'Measured This Batch', value: `${kpis.assay_pct.toFixed(1)}%` },
        ],
        calculation: `Assay % = ${kpis.assay_pct.toFixed(1)} / 100.0 × 100`,
        result: `${kpis.assay_pct.toFixed(1)}%`,
      };
    case 'qualityScore':
      return {
        inputs: [
          { label: 'Assay', value: `${kpis.assay_pct.toFixed(1)}%` },
          { label: 'Target', value: '100.0%' },
        ],
        calculation: `Quality Score = 100 × (1 - |${kpis.assay_pct.toFixed(1)} - 100| / 10)`,
        result: `${kpis.quality_score_pct.toFixed(1)}%`,
      };
    case 'oee':
      return {
        inputs: [
          { label: 'Availability', value: `${kpis.oee_availability_pct.toFixed(1)}%` },
          { label: 'Performance', value: `${kpis.oee_performance_pct.toFixed(1)}%` },
          { label: 'Quality', value: `${kpis.oee_quality_pct.toFixed(1)}%` },
        ],
        calculation: `OEE = ${kpis.oee_availability_pct.toFixed(1)} × ${kpis.oee_performance_pct.toFixed(1)} × ${kpis.oee_quality_pct.toFixed(1)} / 10000`,
        result: `${kpis.oee_pct.toFixed(1)}%`,
      };
    case 'sec':
      return {
        inputs: [
          { label: 'Total Energy', value: `${kpis.total_energy_kwh.toFixed(0)} kWh` },
          { label: 'Actual Output', value: `${kpis.actual_output_kg.toFixed(1)} kg` },
        ],
        calculation: `SEC = ${kpis.total_energy_kwh.toFixed(0)} / ${kpis.actual_output_kg.toFixed(1)}`,
        result: `${kpis.sec_kwh_per_kg.toFixed(2)} kWh/kg`,
      };
    case 'processStability':
      return {
        inputs: [
          { label: 'Temperature', value: `${kpis.process_stability_in_control_pct_temperature.toFixed(1)}% in control` },
          { label: 'Process Pressure', value: `${kpis.process_stability_in_control_pct_process_pressure.toFixed(1)}% in control` },
          { label: 'Flow Rate', value: `${kpis.process_stability_in_control_pct_flow_rate.toFixed(1)}% in control` },
        ],
        calculation: `Average = (${kpis.process_stability_in_control_pct_temperature.toFixed(1)} + ${kpis.process_stability_in_control_pct_process_pressure.toFixed(1)} + ${kpis.process_stability_in_control_pct_flow_rate.toFixed(1)}) / 3`,
        result: `${kpis.process_stability_pct.toFixed(1)}%`,
      };
    case 'cycleTime':
      return {
        inputs: [
          { label: 'Batch Duration', value: `${Math.round(kpis.cycle_time_hrs * 60)} minutes` },
        ],
        calculation: `Cycle Time = ${Math.round(kpis.cycle_time_hrs * 60)} / 60`,
        result: `${kpis.cycle_time_hrs.toFixed(2)} hrs`,
      };
    default:
      return undefined;
  }
}

// Helper function to get KPI definition by ID
export function getKPIDefinition(kpiId: string): KPIDefinition | undefined {
  return KPI_DEFINITIONS[kpiId];
}

// Helper function to get all KPIs by category
export function getKPIsByCategory(category: KPIDefinition['category']): KPIDefinition[] {
  return Object.values(KPI_DEFINITIONS).filter(kpi => kpi.category === category);
}
