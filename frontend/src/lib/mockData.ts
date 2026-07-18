const hash = (str: string) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return Math.abs(h);
};

const pseudoRandom = (seed: string, min: number, max: number) => {
  const h = hash(seed);
  return min + (h % (max - min * 100)) / 100 + (h % 100) / 100;
};

export const getMockPlantData = (plant: string, product: string, batch: string) => ({
  plantName: plant,
  line: 'Line 01',
  product: product,
  recipe: `${product.substring(0,3).toUpperCase()}-RECIPE`,
  currentBatch: batch,
  goldenBatch: `${batch.split('-').slice(0, -1).join('-')}-GOLDEN`,
  stage: 'Granulation',
  progress: Math.floor(pseudoRandom(batch + 'prog', 40, 95)),
  predictedCompletion: `${Math.floor(pseudoRandom(batch + 'time', 1, 4))} Hours 15 Minutes`,
});

const PARAMETER_POOL = [
  { name: 'Temperature', unit: '°C', min: 20, max: 120, var: 2, scale: 1 },
  { name: 'Pressure', unit: 'bar', min: 1.0, max: 10.0, var: 0.5, scale: 1 },
  { name: 'pH', unit: 'pH', min: 4.0, max: 9.0, var: 0.2, scale: 2 },
  { name: 'Mixing Speed', unit: 'RPM', min: 100, max: 500, var: 15, scale: 0 },
  { name: 'Agitator RPM', unit: 'RPM', min: 10, max: 60, var: 5, scale: 0 },
  { name: 'Flow Rate', unit: 'L/min', min: 10, max: 150, var: 8, scale: 1 },
  { name: 'Humidity', unit: '%', min: 30, max: 60, var: 3, scale: 1 },
  { name: 'Reactor Pressure', unit: 'bar', min: 0.5, max: 5.0, var: 0.3, scale: 2 },
  { name: 'Dissolved Oxygen', unit: 'mg/L', min: 2.0, max: 8.0, var: 0.4, scale: 2 },
  { name: 'Viscosity', unit: 'cP', min: 100, max: 1000, var: 25, scale: 0 }
];

export const getMockParameters = (batch: string) => {
  const seedHash = hash(batch);
  const paramCount = 4 + (seedHash % 3); // 4, 5, or 6
  
  const selectedParams = [];
  let available = [...PARAMETER_POOL];
  
  for (let i = 0; i < paramCount; i++) {
    const idx = hash(batch + i) % available.length;
    selectedParams.push(available[idx]);
    available.splice(idx, 1);
  }

  return selectedParams.map((p, i) => {
    const baseValue = pseudoRandom(batch + p.name, p.min, p.max);
    const goldenOffset = (hash(batch + i) % 10 - 5) * (p.var * 0.2);
    
    // Bounds width
    const boundWidth = p.var * 1.5;
    const lowerLimit = parseFloat((baseValue + goldenOffset - boundWidth).toFixed(p.scale));
    const upperLimit = parseFloat((baseValue + goldenOffset + boundWidth).toFixed(p.scale));

    const statusVal = hash(batch + 'stat' + i) % 100;
    const status = statusVal > 85 ? 'critical' : statusVal > 65 ? 'warning' : 'normal';

    let currentOffset = 0;
    if (status === 'critical') currentOffset = p.var * 2.5 * (statusVal % 2 === 0 ? 1 : -1);
    else if (status === 'warning') currentOffset = p.var * 1.2 * (statusVal % 2 === 0 ? 1 : -1);
    else currentOffset = (hash(batch + 'curr' + i) % 100 - 50) / 50 * p.var; // normal fluctuation

    return { 
      name: p.name, 
      current: parseFloat((baseValue + currentOffset).toFixed(p.scale)), 
      golden: parseFloat((baseValue + goldenOffset).toFixed(p.scale)), 
      unit: p.unit, 
      lowerLimit,
      upperLimit,
      variance: parseFloat(p.var.toFixed(p.scale)), 
      stdDev: parseFloat((p.var / 2).toFixed(p.scale)), 
      status 
    };
  });
};

export const getMockTrendData = (batch: string) => {
  const params = getMockParameters(batch);
  
  return Array.from({ length: 60 }).map((_, i) => {
    const time = `${Math.floor(i / 60)}:${(i % 60).toString().padStart(2, '0')}`;
    const point: any = { time };
    
    params.forEach(p => {
      // Golden line is relatively stable around golden target
      const goldenNoise = (Math.sin(i * 0.2) * 0.5 + Math.cos(i * 0.5) * 0.2) * (p.upperLimit - p.lowerLimit) * 0.15;
      const goldenVal = p.golden + goldenNoise;

      // Current line varies and might drift depending on status
      let currentVal = p.golden;
      
      if (p.status === 'normal') {
        currentVal += (Math.sin(i * 0.3) * 0.8) * (p.upperLimit - p.lowerLimit) * 0.2;
      } else if (p.status === 'warning') {
        const drift = (i / 60) * (p.upperLimit - p.lowerLimit) * 0.4;
        currentVal += (Math.sin(i * 0.2)) * (p.upperLimit - p.lowerLimit) * 0.15 + (p.current > p.golden ? drift : -drift);
      } else if (p.status === 'critical') {
        const drift = (i / 60) * (p.upperLimit - p.lowerLimit) * 0.8;
        currentVal += (Math.cos(i * 0.4)) * (p.upperLimit - p.lowerLimit) * 0.2 + (p.current > p.golden ? drift : -drift);
      }
      
      const pScale = PARAMETER_POOL.find(pl => pl.name === p.name)?.scale || 0;
      point[p.name] = parseFloat(currentVal.toFixed(pScale));
      point[`golden_${p.name}`] = parseFloat(goldenVal.toFixed(pScale));
    });
    
    return point;
  });
};

export const getMockKPIs = (plant: string, product: string) => {
  const seed = plant + product;
  return {
    qualityScore: parseFloat(pseudoRandom(seed + 'Q', 95, 99).toFixed(1)),
    yield: parseFloat(pseudoRandom(seed + 'Y', 94, 99).toFixed(1)),
    plantPerformance: parseFloat(pseudoRandom(seed + 'PP', 90, 98).toFixed(1)),
    oee: parseFloat(pseudoRandom(seed + 'O', 85, 95).toFixed(1)),
    goldenBatchSimilarity: parseFloat(pseudoRandom(seed + 'GBS', 92, 98).toFixed(1)),
    activeAnomalies: Math.floor(pseudoRandom(seed + 'AN', 0, 4)),
    criticalAlerts: Math.floor(pseudoRandom(seed + 'CA', 0, 2))
  };
};

export const getMockBatchHistory = (plant: string, product: string) => {
  const plCode = plant.substring(0, 3).toUpperCase();
  const pCode = product.substring(0, 3).toUpperCase();
  return [
    { id: `${plCode}-${pCode}-018`, product: product, start: '2026-07-16 08:00', end: 'Running', status: 'In Progress', yield: '-', quality: '-' },
    { id: `${plCode}-${pCode}-017`, product: product, start: '2026-07-15 14:00', end: '2026-07-16 02:00', status: 'Completed', yield: '98.5%', quality: '97.2%' },
    { id: `${plCode}-${pCode}-016`, product: product, start: '2026-07-14 20:00', end: '2026-07-15 08:30', status: 'Completed', yield: '97.1%', quality: '96.8%' },
    { id: `${plCode}-${pCode}-015`, product: product, start: '2026-07-14 06:00', end: '2026-07-14 18:45', status: 'Completed', yield: '99.0%', quality: '98.9%' }
  ];
};

export const getMockAnomalies = (batch: string) => {
  const seed = batch;
  return [
    { id: `ANM-${Math.floor(pseudoRandom(seed+'A1', 1000, 9999))}`, parameter: 'Flow Rate', severity: 'High', time: '10:45 AM', status: 'Active', description: 'Flow rate exceeded UCL by 4%.' },
    { id: `ANM-${Math.floor(pseudoRandom(seed+'A2', 1000, 9999))}`, parameter: 'Pressure', severity: 'Medium', time: '09:20 AM', status: 'Active', description: 'Pressure variance detected.' }
  ];
};

export const getMockQualityMetrics = (batch: string) => {
  const seed = batch;
  return [
    { name: 'Purity', value: parseFloat(pseudoRandom(seed+'Q1', 99.0, 99.9).toFixed(2)), target: 99.5, status: 'pass' },
    { name: 'Density', value: parseFloat(pseudoRandom(seed+'Q2', 1.20, 1.30).toFixed(2)), target: 1.24, status: 'pass' },
    { name: 'Moisture', value: parseFloat(pseudoRandom(seed+'Q3', 1.5, 2.5).toFixed(1)), target: 2.0, status: 'warning' },
    { name: 'Viscosity', value: Math.floor(pseudoRandom(seed+'Q4', 400, 500)), target: 450, status: 'pass' }
  ];
};

export const getMockAiChat = (batch: string, persona: string = 'Plant Manager') => {
  if (persona === 'Plant Operator') {
    return [
      { sender: 'user', text: `Why is Batch ${batch} slower than the Golden Batch?` },
      { sender: 'ai', text: `Analyzing manufacturing process parameters for batch **${batch}**...\n\nI have identified that the agitator speed is locked at **18 RPM** compared to the reference Golden Batch target of **22 RPM**. This speed reduction is causing a temperature control heat transfer lag, introducing an estimated **45-minute delay** to the granulation phase.` },
      { sender: 'user', text: 'How can I resolve this speed issue?' },
      { sender: 'ai', text: `Troubleshooting guide:\n1. **Verify VFD Drive Calibration**: Check the Variable Variable Frequency Drive feedback loop on Mixer-0 units.\n2. **Check Powder Viscosity**: High viscosity could force current limiters down; review micro-feeder screw rates.\n3. **Verify SOP override limits**: You may manually adjust the speed slider up to 20 RPM under active supervisor signoff.` }
    ];
  }
  
  if (persona === 'Quality Engineer') {
    return [
      { sender: 'user', text: `What caused the moisture anomaly in Batch ${batch}?` },
      { sender: 'ai', text: `Deep-diving anomaly record for **${batch}**...\n\nDuring drying stage, the temperature spiked to **78.5°C** (upper threshold: 75.0°C) while flow draft fell by **4%**. This combination caused the moisture level anomaly (2.3% vs target 2.0%). Root cause is the dry-bleed damper actuator sticking in the pneumatic line.` },
      { sender: 'user', text: 'What are the release compliance implications for this batch?' },
      { sender: 'ai', text: `Compliance Release Assessment:\n- **Purity & Yield**: Within specification limits.\n- **Moisture CQA**: Stale deviation flag. Requires manual laboratory dry-weight verification before digital release signoff.\n- **Risk profile**: Moderate. Recommended to run secondary blending analysis before final release.` }
    ];
  }

  // Default: Plant Manager
  return [
    { sender: 'user', text: 'Summarize the active shift performance across all plants.' },
    { sender: 'ai', text: 'Currently, the Pune Facility is operating at **94.5% efficiency** with an OEE of **91.2%**, satisfying today\'s output targets. The Paracetamol 500mg line is running normally except for minor dry-bleed exhaust damper issues in Dryer-03. Scheduled batch completion times are currently on track.' },
    { sender: 'user', text: 'Are there any major risks for the next shift?' },
    { sender: 'ai', text: 'Based on trend extrapolation:\n1. **Material Shortages**: Low risk. All solvent buffers are at 85% capacity.\n2. **Maintenance**: Boiler-B scheduled checkup due. Clean-in-place (CIP) logs indicate 0 exceptions.\nNo critical blockers detected for the night shift transition.' }
  ];
};

export type RecommendationStatus = 'New' | 'Pending' | 'Acknowledged' | 'Rejected';
export type RecommendationPriority = 'Critical' | 'Medium' | 'Low';

export interface AIRecommendation {
  id: string;
  source: string;
  batchId: string;
  timestamp: string;
  priority: RecommendationPriority;
  status: RecommendationStatus;
  title: string;
  description: string;
  reasoning: string;
  expectedBenefit: string;
  suggestedAction: string;
  plant: string;
  product: string;
}

export const getMockRecommendations = (plant: string, product: string, persona: string = 'Plant Manager'): AIRecommendation[] => {
  const plCode = plant.substring(0, 3).toUpperCase();
  const pCode = product.substring(0, 3).toUpperCase();
  const b1 = `${plCode}-${pCode}-018`;
  const b2 = `${plCode}-${pCode}-017`;

  if (persona === 'Quality Engineer') {
    return [
      {
        id: 'REC-9042', source: 'Quality Workbench', batchId: b1, timestamp: '10:15 AM', priority: 'Critical', status: 'New',
        title: 'Review Moisture Variance before Release',
        description: 'Moisture content is approaching the upper acceptable boundary of 2.0% (Current: 2.3%).',
        reasoning: 'AI models detected a correlation between a sticking dry-bleed damper (Anomaly #ANM-230) and the slightly elevated moisture reading.',
        expectedBenefit: 'Prevents out-of-spec granule release from progressing to tablet compression.',
        suggestedAction: 'Require secondary laboratory dry-weight verification before granting release approval.',
        plant, product
      },
      {
        id: 'REC-9031', source: 'Anomaly Intelligence', batchId: b2, timestamp: 'Yesterday', priority: 'Low', status: 'Acknowledged',
        title: 'Golden Profile Alignment Approved',
        description: 'Batch matched 99.4% of Critical Quality Attributes.',
        reasoning: 'Extensive multi-variate analysis confirms all dissolution and particle size profiles match the Golden Reference.',
        expectedBenefit: 'Automates batch release processing.',
        suggestedAction: 'Proceed with formal QA sign-off.',
        plant, product
      }
    ];
  }

  if (persona === 'Plant Operator') {
    return [
      {
        id: 'REC-8201', source: 'Live Process Monitoring', batchId: b1, timestamp: '15 mins ago', priority: 'Medium', status: 'New',
        title: 'Optimize Agitator Speed',
        description: 'Agitator is locked at 18 RPM but the target envelope indicates 22 RPM.',
        reasoning: 'Viscosity sensors indicate favorable flow dynamics; remaining at lower speeds will unnecessarily delay the batch by 45 minutes.',
        expectedBenefit: 'Recovers 45 minutes of processing time without impacting quality.',
        suggestedAction: 'Increase VFD setpoint for Granulator-03 to 22 RPM.',
        plant, product
      },
      {
        id: 'REC-8182', source: 'Live Process Monitoring', batchId: b2, timestamp: '2 hours ago', priority: 'Medium', status: 'Pending',
        title: 'Inspect Feeder Calibration',
        description: 'Slight powder feed rate fluctuations detected during granulation.',
        reasoning: 'Bulk density variance at the bottom of the hopper typically necessitates a zero-reference recalibration to maintain steady feed.',
        expectedBenefit: 'Maintains strict particle classification sizes in downstream processes.',
        suggestedAction: 'Initiate dynamic feed hopper tare sequence.',
        plant, product
      }
    ];
  }

  // Plant Manager (Executive)
  return [
    {
      id: 'REC-1102', source: 'AI Copilot', batchId: b1, timestamp: '1 hour ago', priority: 'Critical', status: 'New',
      title: 'Schedule Preventive Maintenance on Dryer-03',
      description: 'Thermal expansion variance and sticking actuator damper impacting OEE.',
      reasoning: 'Recurring minor anomalies tracked in the past 6 batches indicate impending actuator component failure.',
      expectedBenefit: 'Avoids 8 hours of unplanned downtime next week and preserves 94% OEE trend.',
      suggestedAction: 'Create highest priority work order for maintenance team to replace the pneumatic cylinder in Dryer-03 over the weekend gap.',
      plant, product
    },
    {
      id: 'REC-1090', source: 'Dashboard Insights', batchId: b2, timestamp: 'Yesterday', priority: 'Medium', status: 'Rejected',
      title: 'Adjust Production Schedule to Cover Shortfall',
      description: 'Suggesting a shift in production runs to match slight yield losses from last month.',
      reasoning: 'Overall yield was 98.2%, below the 99% theoretical target. Running an extra fractional batch will close order buffers.',
      expectedBenefit: 'Restores inventory safety threshold by 12%.',
      suggestedAction: 'Add 1 additional batch run to Shift C schedule.',
      plant, product
    }
  ];
};

export const getMockActivity = () => [
  { time: '10 mins ago', text: 'Operator Acknowledged "Optimize Agitator Speed"' },
  { time: '45 mins ago', text: 'AI updated Risk Profile on REC-9042 from Medium to Critical' },
  { time: '2 hours ago', text: 'Plant Manager Rejected "Adjust Production Schedule"' },
  { time: 'Yesterday', text: 'Quality Engineer Acknowledged "Golden Profile Alignment"' }
];

