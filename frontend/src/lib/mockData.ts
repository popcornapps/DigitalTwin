export const mockPlantData = {
  plantName: 'Hyderabad Pharma Manufacturing Plant',
  line: 'Line 03',
  product: 'Paracetamol 500 mg Tablet',
  recipe: 'PCM-TAB-01',
  currentBatch: 'BT-2026-018',
  goldenBatch: 'BT-2025-143',
  stage: 'Granulation',
  progress: 68,
  predictedCompletion: '2 Hours 15 Minutes',
};

export const mockParameters = [
  { name: 'Temperature', current: 78.4, golden: 77.9, unit: '°C', variance: 0.34, stdDev: 0.58, status: 'normal' },
  { name: 'Pressure', current: 2.8, golden: 2.6, unit: 'bar', variance: 0.04, stdDev: 0.2, status: 'warning' },
  { name: 'Flow Rate', current: 52, golden: 50, unit: 'L/min', variance: 4.0, stdDev: 2.0, status: 'critical' },
  { name: 'Humidity', current: 48, golden: 46, unit: '%', variance: 2.0, stdDev: 1.4, status: 'normal' },
];

export const mockTrendData = Array.from({ length: 60 }).map((_, i) => ({
  time: `${Math.floor(i / 60)}:${(i % 60).toString().padStart(2, '0')}`,
  temp: 77 + Math.random() * 2,
  goldenTemp: 77.5 + Math.random() * 0.5,
  pressure: 2.5 + Math.random() * 0.5,
  goldenPressure: 2.6 + Math.random() * 0.1,
}));

export const mockKPIs = {
  qualityScore: 96.7,
  yield: 98.2,
  plantPerformance: 94.5,
  oee: 89.3,
  goldenBatchSimilarity: 95.0,
  activeAnomalies: 2,
  criticalAlerts: 1
};

export const mockBatchHistory = [
  { id: 'BT-2026-018', product: 'Paracetamol 500mg', start: '2026-07-16 08:00', end: 'Running', status: 'In Progress', yield: '-', quality: '-' },
  { id: 'BT-2026-017', product: 'Paracetamol 500mg', start: '2026-07-15 14:00', end: '2026-07-16 02:00', status: 'Completed', yield: '98.5%', quality: '97.2%' },
  { id: 'BT-2026-016', product: 'Paracetamol 500mg', start: '2026-07-14 20:00', end: '2026-07-15 08:30', status: 'Completed', yield: '97.1%', quality: '96.8%' },
  { id: 'BT-2026-015', product: 'Paracetamol 500mg', start: '2026-07-14 06:00', end: '2026-07-14 18:45', status: 'Completed', yield: '99.0%', quality: '98.9%' }
];

export const mockAnomalies = [
  { id: 'ANM-1049', parameter: 'Flow Rate', severity: 'High', time: '10:45 AM', status: 'Active', description: 'Flow rate exceeded UCL by 4%.' },
  { id: 'ANM-1048', parameter: 'Pressure', severity: 'Medium', time: '09:20 AM', status: 'Active', description: 'Pressure variance detected.' }
];

export const mockQualityMetrics = [
  { name: 'Purity', value: 99.8, target: 99.5, status: 'pass' },
  { name: 'Density', value: 1.25, target: 1.24, status: 'pass' },
  { name: 'Moisture', value: 2.1, target: 2.0, status: 'warning' },
  { name: 'Viscosity', value: 450, target: 450, status: 'pass' }
];

export const mockAiChat = [
  { sender: 'user', text: 'Why is Batch BT-2026-018 slower than the Golden Batch?' },
  { sender: 'ai', text: 'Analyzing historical process parameters... \n\nI have identified that the Agitator Speed in the Granulation stage is running at 18 RPM compared to the Golden Batch average of 22 RPM. This reduction is causing an estimated 45-minute delay.' },
  { sender: 'user', text: 'Generate a CAPA recommendation for this deviation.' },
  { sender: 'ai', text: 'CAPA Recommendation Generated:\n\n**Issue**: Agitator speed variance causing batch delay.\n**Action**: Inspect VFD drive on Granulator-03. Calibrate speed sensor. Update SOP for manual override limit to 20 RPM.' }
];

