import { PLANTS } from './config.ts';
import type { BatchPlanEntry, ScenarioType, Severity } from './types.ts';

const SINGLE_PARAM_SCENARIOS: Record<'temperature' | 'agitator' | 'pressure' | 'flowRate', ScenarioType[]> = {
  temperature: [
    'Temperature_HeaterFault',
    'Temperature_HeatExchangerFouling',
    'Temperature_SensorDrift',
    'Temperature_PidHunting',
  ],
  agitator: ['Agitator_VfdLock', 'Agitator_LoadCreep', 'Agitator_OverloadTrip', 'Agitator_BearingWear'],
  pressure: [
    'Pressure_DamperSticking',
    'Pressure_FilterLoading',
    'Pressure_SealLeak',
    'Pressure_BlowerFluctuation',
  ],
  flowRate: [
    'FlowRate_FanFault',
    'FlowRate_FilterLoadingDecay',
    'FlowRate_DamperMiscalibration',
    'FlowRate_DuctBlockage',
  ],
};

let plantCursor = 0;
const nextPlant = (): string => {
  const plant = PLANTS[plantCursor % PLANTS.length];
  plantCursor += 1;
  return plant;
};

let seqCursor = 1;
const nextBatchId = (): string => {
  const id = `PAR-${String(seqCursor).padStart(3, '0')}`;
  seqCursor += 1;
  return id;
};

const buildEntry = (scenario: ScenarioType, severity: Severity): BatchPlanEntry => ({
  batchId: nextBatchId(),
  plant: nextPlant(),
  isGoldenBatch: false,
  scenario,
  severity,
});

export const buildBatchPlan = (): BatchPlanEntry[] => {
  plantCursor = 0;
  seqCursor = 1;
  const plan: BatchPlanEntry[] = [];

  plan.push({ batchId: 'PAR-GOLDEN', plant: PLANTS[0], isGoldenBatch: true, scenario: 'None', severity: 'None' });

  for (let i = 0; i < 80; i++) {
    plan.push(buildEntry('None', 'None'));
  }

  for (const scenarios of Object.values(SINGLE_PARAM_SCENARIOS)) {
    for (let i = 0; i < 6; i++) {
      plan.push(buildEntry(scenarios[i % scenarios.length], 'Warning'));
    }
  }

  for (let i = 0; i < 6; i++) {
    plan.push(buildEntry('Correlated_DryerRestriction', 'Warning'));
  }
  for (let i = 0; i < 4; i++) {
    plan.push(buildEntry('Correlated_DryerRestriction', 'Critical'));
  }

  const criticalSpread: ScenarioType[] = [
    SINGLE_PARAM_SCENARIOS.temperature[0],
    SINGLE_PARAM_SCENARIOS.temperature[1],
    SINGLE_PARAM_SCENARIOS.pressure[0],
    SINGLE_PARAM_SCENARIOS.flowRate[0],
    SINGLE_PARAM_SCENARIOS.agitator[0],
  ];
  for (const scenario of criticalSpread) {
    plan.push(buildEntry(scenario, 'Critical'));
  }

  return plan;
};
