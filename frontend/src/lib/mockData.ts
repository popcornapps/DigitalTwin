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

export const getMockAiChat = (batch: string) => [
  { sender: 'user', text: `Why is Batch ${batch} slower than the Golden Batch?` },
  { sender: 'ai', text: 'Analyzing historical process parameters... \n\nI have identified that the Agitator Speed in the Granulation stage is running at 18 RPM compared to the Golden Batch average of 22 RPM. This reduction is causing an estimated 45-minute delay.' },
  { sender: 'user', text: 'Generate a CAPA recommendation for this deviation.' },
  { sender: 'ai', text: 'CAPA Recommendation Generated:\n\n**Issue**: Agitator speed variance causing batch delay.\n**Action**: Inspect VFD drive on Granulator-03. Calibrate speed sensor. Update SOP for manual override limit to 20 RPM.' }
];

