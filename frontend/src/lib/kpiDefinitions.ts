// KPI Educational Definitions for PharmaTwin Digital Twin
// Central source of truth for all KPI metadata and educational content

export interface KPIDefinition {
  id: string;
  name: string;
  shortName: string;
  definition: string;
  importance: string;
  formula: string;
  exampleCalculation: {
    inputs: { label: string; value: string }[];
    calculation: string;
    result: string;
  };
  increasingFactors: string[];
  decreasingFactors: string[];
  benchmarkRange: string;
  influencingParameters: string[];
  digitalTwinNote: string;
  category: 'efficiency' | 'quality' | 'performance' | 'energy' | 'similarity';
}

export const KPI_DEFINITIONS: Record<string, KPIDefinition> = {
  oee: {
    id: 'oee',
    name: 'Overall Equipment Effectiveness (OEE)',
    shortName: 'OEE',
    definition: 'OEE measures how efficiently manufacturing equipment operates by combining three factors: Availability (uptime), Performance (speed), and Quality (good output). It\'s the gold standard metric in manufacturing.',
    importance: 'OEE is the single most important metric for understanding manufacturing productivity. World-class manufacturers target 85%+ OEE. It reveals hidden capacity and identifies improvement opportunities across equipment, processes, and quality.',
    formula: 'OEE = Availability × Performance × Quality',
    exampleCalculation: {
      inputs: [
        { label: 'Availability', value: '95% (equipment ran 22.8 out of 24 planned hours)' },
        { label: 'Performance', value: '91% (ran at 91% of maximum speed)' },
        { label: 'Quality', value: '97% (97% of output passed quality checks)' }
      ],
      calculation: 'OEE = 0.95 × 0.91 × 0.97',
      result: '83.9%'
    },
    increasingFactors: [
      'Preventive maintenance reducing unplanned downtime',
      'Optimized equipment speeds and cycle times',
      'Process stability improving first-pass yield',
      'Reduced changeover and setup times',
      'Operator training and standard work procedures',
      'Real-time monitoring and quick issue resolution'
    ],
    decreasingFactors: [
      'Unplanned equipment breakdowns and failures',
      'Equipment running below optimal speed',
      'Quality defects requiring rework or scrap',
      'Extended changeover times between products',
      'Waiting for materials, operators, or quality approvals',
      'Minor stoppages and idling'
    ],
    benchmarkRange: 'World-class: 85%+, Good: 70-85%, Fair: 60-70%, Poor: <60%',
    influencingParameters: [
      'Equipment runtime vs. planned production time',
      'Actual throughput vs. ideal cycle time',
      'Good units produced vs. total units started',
      'Downtime events (breakdowns, changeovers, waiting)',
      'Speed losses (slow cycles, minor stops)',
      'Quality losses (defects, rework, startup rejects)'
    ],
    digitalTwinNote: 'In a real Digital Twin, OEE would be calculated live from: (1) Equipment state sensors (running/stopped/idle), (2) Production counters measuring actual output, (3) Quality inspection results, (4) Downtime event logs from SCADA/MES systems. ML models would predict OEE degradation before it happens based on equipment condition.',
    category: 'efficiency'
  },

  yield: {
    id: 'yield',
    name: 'Batch Yield',
    shortName: 'Yield',
    definition: 'Yield is the percentage of raw materials that successfully become finished product. It measures material efficiency and process losses throughout manufacturing.',
    importance: 'Yield directly impacts profitability and sustainability. Each 1% improvement in yield can save millions in material costs. Low yield indicates waste, inefficiency, or quality problems that need root cause investigation.',
    formula: 'Yield = (Actual Output / Theoretical Maximum Output) × 100%',
    exampleCalculation: {
      inputs: [
        { label: 'Raw Materials Input', value: '1000 kg' },
        { label: 'Theoretical Yield', value: '990 kg (accounting for unavoidable losses)' },
        { label: 'Actual Output', value: '970 kg of finished tablets' }
      ],
      calculation: 'Yield = (970 kg / 990 kg) × 100%',
      result: '97.98%'
    },
    increasingFactors: [
      'Optimized mixing and granulation parameters',
      'Proper equipment calibration (feeders, scales)',
      'Reduced dust and material handling losses',
      'Improved process control reducing off-spec batches',
      'Better raw material quality and consistency',
      'Operator adherence to Standard Operating Procedures'
    ],
    decreasingFactors: [
      'Material spills and dust losses during transfer',
      'Product sticking to equipment walls',
      'Over-drying leading to excessive moisture loss',
      'Rejected batches due to quality failures',
      'Incomplete material discharge from mixers',
      'Off-spec intermediate products requiring disposal'
    ],
    benchmarkRange: 'Pharmaceutical industry: 96-99.5% (high-value products target 99%+)',
    influencingParameters: [
      'Mixing time and intensity',
      'Granulation moisture and binder amount',
      'Drying temperature and time',
      'Compression force and tablet hardness',
      'Equipment cleaning losses',
      'Dust collection system efficiency'
    ],
    digitalTwinNote: 'A real Digital Twin would calculate yield from: (1) Weighing systems measuring raw material dispensing, (2) In-process weight checks at each stage, (3) Final batch weight from packaging scales, (4) Reject/rework tracking from quality systems. Predictive models would forecast yield based on current process conditions.',
    category: 'efficiency'
  },

  qualityScore: {
    id: 'qualityScore',
    name: 'Quality Score',
    shortName: 'Quality Score',
    definition: 'Quality Score is a weighted composite metric representing how well a batch meets all quality specifications. It combines multiple Critical Quality Attributes (CQAs) like purity, dissolution, hardness, moisture, and content uniformity.',
    importance: 'Quality Score determines batch release approval and regulatory compliance. Poor quality leads to batch rejection, rework costs, regulatory findings, and patient safety risks. Consistent high quality scores indicate process capability and control.',
    formula: 'Quality Score = Σ (CQA Test Result × Weight) for all CQAs',
    exampleCalculation: {
      inputs: [
        { label: 'Purity', value: '98.2% (weight: 30%)' },
        { label: 'Dissolution', value: '96.8% (weight: 25%)' },
        { label: 'Hardness', value: '95.5% (weight: 20%)' },
        { label: 'Moisture Content', value: '97.0% (weight: 15%)' },
        { label: 'Content Uniformity', value: '96.0% (weight: 10%)' }
      ],
      calculation: 'Quality Score = (98.2×0.3) + (96.8×0.25) + (95.5×0.2) + (97×0.15) + (96×0.1)',
      result: '96.88%'
    },
    increasingFactors: [
      'Stable process parameters within narrow control limits',
      'High-quality raw materials from qualified suppliers',
      'Proper equipment calibration and maintenance',
      'Optimal drying, mixing, and compression parameters',
      'Effective in-process quality checks and corrections',
      'Adherence to Golden Batch process profile'
    ],
    decreasingFactors: [
      'Process parameter drift (temperature, pressure, humidity)',
      'Raw material variability or out-of-spec materials',
      'Equipment malfunction or poor calibration',
      'Environmental condition changes (seasonal humidity)',
      'Operator errors or procedure deviations',
      'Insufficient mixing or granulation time'
    ],
    benchmarkRange: 'Pharmaceutical release standard: >95% (typical 97-99.5%)',
    influencingParameters: [
      'Drying temperature and time (affects moisture)',
      'Mixing speed and duration (affects content uniformity)',
      'Compression force (affects hardness and dissolution)',
      'Granulation liquid addition rate (affects particle size)',
      'Ambient humidity (affects moisture uptake)',
      'Raw material purity and particle size distribution'
    ],
    digitalTwinNote: 'In a real Digital Twin, Quality Score would integrate: (1) Lab instrument results (HPLC for purity, dissolution tester, hardness tester, moisture analyzer), (2) In-process sensors (NIR spectroscopy for real-time content), (3) Historical correlations between process parameters and quality outcomes. ML models would predict final quality scores mid-batch to enable corrective actions.',
    category: 'quality'
  },

  processStability: {
    id: 'processStability',
    name: 'Process Stability',
    shortName: 'Process Stability',
    definition: 'Process Stability measures how consistently critical process parameters remain within target control limits. High stability means predictable, reproducible manufacturing with minimal variation.',
    importance: 'Process stability is a leading indicator of quality and efficiency. Stable processes produce consistent batches, reduce waste, and minimize unexpected deviations. Regulatory agencies expect demonstrated process stability for continued manufacturing approval.',
    formula: 'Process Stability = (Time in Control / Total Time) × 100% averaged across all critical parameters',
    exampleCalculation: {
      inputs: [
        { label: 'Temperature', value: '58 out of 60 minutes within ±1% (96.7%)' },
        { label: 'Pressure', value: '60 out of 60 minutes within ±1% (100%)' },
        { label: 'pH', value: '57 out of 60 minutes within ±1% (95%)' },
        { label: 'Mixing Speed', value: '59 out of 60 minutes within ±1% (98.3%)' },
        { label: 'Flow Rate', value: '56 out of 60 minutes within ±1% (93.3%)' },
        { label: 'Humidity', value: '59 out of 60 minutes within ±1% (98.3%)' }
      ],
      calculation: 'Average = (96.7 + 100 + 95 + 98.3 + 93.3 + 98.3) / 6',
      result: '96.9%'
    },
    increasingFactors: [
      'Well-tuned PID controller parameters',
      'High-quality, calibrated sensors and instruments',
      'Preventive maintenance preventing equipment drift',
      'Automated control systems vs. manual adjustments',
      'Isolation from external disturbances (ambient conditions)',
      'Fast control loop response times'
    ],
    decreasingFactors: [
      'Sensor drift or calibration errors',
      'Worn equipment (valves, actuators, heaters)',
      'Manual operator interventions',
      'External disturbances (power fluctuations, ambient temp changes)',
      'Poorly tuned control logic',
      'Material or feedstock variability'
    ],
    benchmarkRange: 'Pharmaceutical process validation target: >95% (best-in-class: 98%+)',
    influencingParameters: [
      'Temperature control loop performance',
      'Pressure regulation accuracy',
      'pH buffer and control response',
      'Motor speed control (mixers, agitators)',
      'Flow rate valve control',
      'Humidity conditioning system performance'
    ],
    digitalTwinNote: 'A real Digital Twin would calculate process stability from: (1) High-frequency sensor data (1-second intervals for temperature, pressure, pH, etc.), (2) Control system setpoints and actual values, (3) Statistical Process Control (SPC) charts tracking variation over time. Predictive analytics would alert operators to stability degradation trends before they cause quality issues.',
    category: 'performance'
  },

  cycleTime: {
    id: 'cycleTime',
    name: 'Cycle Time / Batch Duration',
    shortName: 'Cycle Time',
    definition: 'Cycle Time is the total elapsed time from batch start to completion. It includes all process stages: mixing, granulation, drying, compression, and packaging. Shorter cycle time means higher throughput and production capacity.',
    importance: 'Cycle time directly determines production capacity and customer delivery speed. Reducing cycle time without sacrificing quality increases output, lowers cost per unit, and improves responsiveness to demand. It\'s a key lever for operational efficiency.',
    formula: 'Cycle Time = Batch End Time - Batch Start Time',
    exampleCalculation: {
      inputs: [
        { label: 'Mixing Stage', value: '25 minutes' },
        { label: 'Granulation Stage', value: '180 minutes' },
        { label: 'Drying Stage', value: '270 minutes' },
        { label: 'Compression Stage', value: '240 minutes' },
        { label: 'Packaging Stage', value: '45 minutes' }
      ],
      calculation: 'Total = 25 + 180 + 270 + 240 + 45',
      result: '760 minutes = 12.67 hours'
    },
    increasingFactors: [
      'Optimized equipment speeds (faster mixing, drying)',
      'Parallel processing where possible',
      'Reduced changeover and setup times',
      'Elimination of waiting time between stages',
      'Automated material handling and transfers',
      'Pre-qualified process parameters reducing trial-and-error'
    ],
    decreasingFactors: [
      'Conservative processing speeds (slower to ensure quality)',
      'Equipment downtime and breakdowns',
      'Waiting for quality approvals between stages',
      'Manual material handling and transfers',
      'Changeover time for multi-product lines',
      'Process deviations requiring investigation or rework'
    ],
    benchmarkRange: 'Varies by product: Tablets 8-16 hrs, Capsules 10-20 hrs, Sterile products 24-72 hrs',
    influencingParameters: [
      'Mixing speed and duration',
      'Drying temperature (higher = faster but quality risk)',
      'Granulation liquid addition rate',
      'Compression turret speed (tablets/minute)',
      'Material transfer methods (pneumatic vs. manual)',
      'In-process testing and hold times'
    ],
    digitalTwinNote: 'A real Digital Twin would track cycle time from: (1) Batch execution system timestamps (start/end of each stage), (2) Equipment state transitions (idle → running → complete), (3) Material tracking through each process step. ML models would predict remaining cycle time and identify bottleneck stages dynamically.',
    category: 'performance'
  },

  sec: {
    id: 'sec',
    name: 'Specific Energy Consumption (SEC)',
    shortName: 'SEC',
    definition: 'SEC measures the energy (electricity) consumed per kilogram of finished product. It\'s a key sustainability and cost metric showing energy efficiency of the manufacturing process.',
    importance: 'Energy costs are a significant operating expense (5-15% of production cost). Lower SEC reduces costs, carbon footprint, and environmental impact. It\'s increasingly important for corporate sustainability goals and regulatory carbon reporting.',
    formula: 'SEC = Total Energy Consumed (kWh) / Total Product Output (kg)',
    exampleCalculation: {
      inputs: [
        { label: 'Mixer Energy', value: '80 kWh' },
        { label: 'Dryer Energy', value: '120 kWh' },
        { label: 'Compressor Energy', value: '25 kWh' },
        { label: 'HVAC Energy', value: '15 kWh' },
        { label: 'Total Energy', value: '240 kWh' },
        { label: 'Batch Output', value: '150 kg tablets' }
      ],
      calculation: 'SEC = 240 kWh / 150 kg',
      result: '1.6 kWh/kg'
    },
    increasingFactors: [
      'Energy-efficient equipment (variable frequency drives)',
      'Optimized drying temperature and time',
      'Heat recovery systems',
      'Larger batch sizes (fixed energy spread over more output)',
      'Equipment maintenance reducing friction and inefficiency',
      'Idle equipment powered down when not in use'
    ],
    decreasingFactors: [
      'Inefficient or old equipment',
      'Excessive drying time or temperature',
      'Small batch sizes (high fixed energy per unit)',
      'Equipment running idle or underutilized',
      'Compressed air leaks and pneumatic losses',
      'Poor insulation leading to heat loss'
    ],
    benchmarkRange: 'Pharmaceutical manufacturing: 0.8-2.5 kWh/kg (depends on product complexity)',
    influencingParameters: [
      'Drying temperature and duration (major energy consumer)',
      'Mixing intensity and time',
      'HVAC requirements (cleanroom classification)',
      'Compressed air usage (pneumatic conveyors, actuators)',
      'Batch size (economies of scale)',
      'Equipment utilization rate'
    ],
    digitalTwinNote: 'A real Digital Twin would calculate SEC from: (1) Power meters on all major equipment (mixers, dryers, compressors, HVAC), (2) Batch production records showing output weight, (3) Facility-level energy management systems. Predictive models would optimize process parameters to minimize energy use while maintaining quality.',
    category: 'energy'
  },

  plantPerformance: {
    id: 'plantPerformance',
    name: 'Plant Performance',
    shortName: 'Plant Performance',
    definition: 'Plant Performance is a high-level score measuring overall facility operational efficiency. It combines OEE across all lines, schedule adherence, resource utilization, and quality compliance into a single executive metric.',
    importance: 'Plant Performance gives leadership a single number to understand facility health. It drives strategic decisions on capacity investments, process improvements, and resource allocation. It\'s used in executive dashboards and quarterly business reviews.',
    formula: 'Plant Performance = Weighted Average of (OEE, Schedule Adherence, Utilization, Quality Compliance)',
    exampleCalculation: {
      inputs: [
        { label: 'Average OEE Across All Lines', value: '90% (weight: 40%)' },
        { label: 'Schedule Adherence', value: '96% batches on time (weight: 30%)' },
        { label: 'Equipment Utilization', value: '94% capacity used (weight: 20%)' },
        { label: 'Quality Compliance Rate', value: '97% batches passed (weight: 10%)' }
      ],
      calculation: 'Plant Performance = (90×0.4) + (96×0.3) + (94×0.2) + (97×0.1)',
      result: '92.7%'
    },
    increasingFactors: [
      'High OEE across all production lines',
      'On-time batch completions meeting demand',
      'Maximized equipment utilization',
      'Minimal quality failures and rework',
      'Effective maintenance programs',
      'Cross-functional collaboration and continuous improvement'
    ],
    decreasingFactors: [
      'Unplanned downtime affecting multiple lines',
      'Missed production schedules and backorders',
      'Underutilized capacity and idle equipment',
      'Quality problems causing batch rejections',
      'Resource constraints (materials, labor, utilities)',
      'Poor coordination between shifts or departments'
    ],
    benchmarkRange: 'Best-in-class plants: 90%+, Average: 75-85%, Needs improvement: <70%',
    influencingParameters: [
      'Individual line OEE performance',
      'Production schedule complexity and changes',
      'Material availability and supply chain',
      'Labor availability and skill level',
      'Preventive maintenance effectiveness',
      'Quality system capability (Cpk, first-pass yield)'
    ],
    digitalTwinNote: 'A real Digital Twin would aggregate plant performance from: (1) MES/ERP systems tracking all batch schedules and completions, (2) Equipment state across all lines, (3) Quality management system pass/fail rates, (4) Resource planning systems. Executive dashboards would drill down from plant-level to line-level to batch-level issues.',
    category: 'performance'
  },

  goldenBatchSimilarity: {
    id: 'goldenBatchSimilarity',
    name: 'Golden Batch Similarity',
    shortName: 'Similarity',
    definition: 'Golden Batch Similarity measures how closely a current batch follows the process trajectory of the ideal "Golden Batch" reference. It compares parameter profiles, timing, and quality attributes to the best-ever batch.',
    importance: 'Replicating successful batches is key to consistent quality and efficiency. High similarity means operators are following proven best practices. Low similarity indicates deviations that may lead to quality or efficiency problems.',
    formula: 'Similarity = Statistical comparison of (Parameter Trajectories + Quality Attributes + Process Events)',
    exampleCalculation: {
      inputs: [
        { label: 'Temperature Profile Match', value: '97%' },
        { label: 'Pressure Profile Match', value: '95%' },
        { label: 'Mixing Speed Profile Match', value: '98%' },
        { label: 'Quality Attribute Match', value: '96%' },
        { label: 'Process Timing Match', value: '94%' }
      ],
      calculation: 'Average similarity = (97 + 95 + 98 + 96 + 94) / 5',
      result: '96.0%'
    },
    increasingFactors: [
      'Strict adherence to Golden Batch setpoints',
      'Automated control systems following reference recipes',
      'Consistent raw material quality',
      'Equipment in same condition as Golden Batch run',
      'Similar environmental conditions (temperature, humidity)',
      'Experienced operators familiar with process'
    ],
    decreasingFactors: [
      'Manual overrides deviating from Golden Batch recipe',
      'Equipment degradation or different equipment used',
      'Raw material variability from Golden Batch',
      'Environmental changes (seasonal, facility)',
      'Different operators with varying practices',
      'Process timing differences'
    ],
    benchmarkRange: 'Target: >95% similarity for validated processes, >90% acceptable, <85% investigate',
    influencingParameters: [
      'Process parameter trajectories vs. Golden Batch',
      'Sequence and timing of process stages',
      'Raw material properties (particle size, moisture)',
      'Equipment calibration and condition',
      'Operator actions and interventions',
      'Environmental factors (ambient temperature, humidity)'
    ],
    digitalTwinNote: 'A real Digital Twin would calculate similarity using: (1) Time-series comparison algorithms (Dynamic Time Warping, correlation) on all sensor data, (2) Quality attribute distance metrics, (3) Process event sequence matching. ML models would provide real-time similarity scores during batch execution to alert when deviating from Golden Batch.',
    category: 'similarity'
  }
};

// Helper function to get KPI definition by ID
export function getKPIDefinition(kpiId: string): KPIDefinition | undefined {
  return KPI_DEFINITIONS[kpiId];
}

// Helper function to get all KPIs by category
export function getKPIsByCategory(category: KPIDefinition['category']): KPIDefinition[] {
  return Object.values(KPI_DEFINITIONS).filter(kpi => kpi.category === category);
}
