import type { PhaseBoundaries, ScenarioType, Severity } from './types.ts';
import type { SeededRandom } from './rng.ts';
import { temperatureBaseline } from './baseline.ts';

export type ParamKey = 'temperature' | 'process_pressure' | 'flow_rate' | 'agitator_rpm';

export interface FaultEffect {
  offset: Partial<Record<ParamKey, number>>;
  noiseMultiplier: Partial<Record<ParamKey, number>>;
  lockValue: Partial<Record<ParamKey, number>>;
}

const noEffect: FaultEffect = { offset: {}, noiseMultiplier: {}, lockValue: {} };

type Shape = 'step' | 'drift' | 'oscillation' | 'lock';

interface ScenarioSpec {
  param: ParamKey;
  shape: Shape;
  warningMagnitude: number;
  criticalMagnitude: number;
  // Returns the [start, end) window within which this fault is physically plausible.
  activeWindow: (b: PhaseBoundaries) => [number, number];
  rampInMinutes?: number;
}

const SCENARIO_TABLE: Partial<Record<ScenarioType, ScenarioSpec>> = {
  Temperature_HeaterFault: {
    param: 'temperature', shape: 'step', warningMagnitude: 3.0, criticalMagnitude: 6.5,
    activeWindow: (b) => [b.transferEnd, b.dryingEnd], rampInMinutes: 15,
  },
  Temperature_HeatExchangerFouling: {
    param: 'temperature', shape: 'drift', warningMagnitude: -4.5, criticalMagnitude: -9.0,
    activeWindow: (b) => [b.transferEnd, b.dryingEnd],
  },
  Temperature_SensorDrift: {
    param: 'temperature', shape: 'lock', warningMagnitude: 2, criticalMagnitude: 5,
    activeWindow: (b) => [b.transferEnd, b.coolingEnd],
  },
  Temperature_PidHunting: {
    param: 'temperature', shape: 'oscillation', warningMagnitude: 3, criticalMagnitude: 6,
    activeWindow: (b) => [b.transferEnd, b.dryingEnd],
  },
  Agitator_VfdLock: {
    param: 'agitator_rpm', shape: 'lock', warningMagnitude: 18, criticalMagnitude: 15,
    activeWindow: (b) => [b.dryMixingEnd, b.wetMassingEnd],
  },
  Agitator_LoadCreep: {
    param: 'agitator_rpm', shape: 'drift', warningMagnitude: -2, criticalMagnitude: -4,
    activeWindow: (b) => [b.dryMixingEnd, b.wetMassingEnd],
  },
  Agitator_OverloadTrip: {
    param: 'agitator_rpm', shape: 'step', warningMagnitude: -7, criticalMagnitude: -14,
    activeWindow: (b) => [b.dryMixingEnd, b.wetMassingEnd], rampInMinutes: 2,
  },
  Agitator_BearingWear: {
    param: 'agitator_rpm', shape: 'oscillation', warningMagnitude: 3, criticalMagnitude: 6,
    activeWindow: (b) => [b.dryMixingEnd, b.wetMassingEnd],
  },
  Pressure_DamperSticking: {
    param: 'process_pressure', shape: 'drift', warningMagnitude: 0.13, criticalMagnitude: 0.28,
    activeWindow: (b) => [b.transferEnd, b.dryingEnd],
  },
  Pressure_FilterLoading: {
    param: 'process_pressure', shape: 'drift', warningMagnitude: 0.12, criticalMagnitude: 0.25,
    activeWindow: (b) => [b.transferEnd, b.dryingEnd],
  },
  Pressure_SealLeak: {
    param: 'process_pressure', shape: 'step', warningMagnitude: -0.16, criticalMagnitude: -0.32,
    activeWindow: (b) => [b.transferEnd, b.dryingEnd], rampInMinutes: 5,
  },
  Pressure_BlowerFluctuation: {
    param: 'process_pressure', shape: 'oscillation', warningMagnitude: 3, criticalMagnitude: 6,
    activeWindow: (b) => [b.transferEnd, b.dryingEnd],
  },
  FlowRate_FanFault: {
    param: 'flow_rate', shape: 'step', warningMagnitude: -6, criticalMagnitude: -15,
    activeWindow: (b) => [b.transferEnd, b.dryingEnd], rampInMinutes: 8,
  },
  FlowRate_FilterLoadingDecay: {
    param: 'flow_rate', shape: 'drift', warningMagnitude: -7, criticalMagnitude: -15,
    activeWindow: (b) => [b.transferEnd, b.dryingEnd],
  },
  FlowRate_DamperMiscalibration: {
    param: 'flow_rate', shape: 'step', warningMagnitude: 5, criticalMagnitude: 9,
    activeWindow: (b) => [b.transferEnd, b.dryingEnd], rampInMinutes: 8,
  },
  FlowRate_DuctBlockage: {
    param: 'flow_rate', shape: 'step', warningMagnitude: -8, criticalMagnitude: -20,
    activeWindow: (b) => [b.transferEnd, b.dryingEnd], rampInMinutes: 3,
  },
};

export interface ResolvedFault {
  spec: ScenarioSpec;
  onset: number;
  magnitude: number;
  lockValue?: number;
}

export interface ResolvedCorrelatedFault {
  onset: number;
  peakAt: number;
  restrictionEnd: number;
  pressurePeak: number;
  flowPeak: number;
  recoverFraction: number;
  durationExtensionMinutes: number;
}

export const resolveFault = (
  scenario: ScenarioType,
  severity: Severity,
  b: PhaseBoundaries,
  rng: SeededRandom,
): ResolvedFault | null => {
  const spec = SCENARIO_TABLE[scenario];
  if (!spec || severity === 'None') return null;

  const [windowStart, windowEnd] = spec.activeWindow(b);
  const onset = Math.round(rng.uniform(windowStart, windowStart + (windowEnd - windowStart) * 0.4));
  const magnitude = severity === 'Critical' ? spec.criticalMagnitude : spec.warningMagnitude;

  const lockValue =
    spec.shape !== 'lock'
      ? undefined
      : spec.param === 'temperature'
        ? temperatureBaseline(onset, b, 0) + magnitude
        : magnitude; // agitator lock: magnitude IS the absolute stuck RPM value

  return { spec, onset, magnitude, lockValue };
};

export const resolveCorrelatedFault = (
  severity: Severity,
  b: PhaseBoundaries,
  rng: SeededRandom,
): ResolvedCorrelatedFault => {
  const onset = Math.round(rng.uniform(b.transferEnd + 10, b.transferEnd + (b.dryingEnd - b.transferEnd) * 0.35));
  const isCritical = severity === 'Critical';
  const restrictionEnd = isCritical ? b.dryingEnd + 90 : b.dryingEnd;
  const peakAt = onset + (restrictionEnd - onset) * (isCritical ? 0.8 : 1.0);

  return {
    onset,
    peakAt,
    restrictionEnd,
    pressurePeak: isCritical ? 0.3 : 0.14,
    flowPeak: isCritical ? -20 : -10,
    recoverFraction: isCritical ? 0.4 : 0,
    durationExtensionMinutes: isCritical ? Math.round(rng.uniform(70, 90)) : 0,
  };
};

const stepOffset = (t: number, onset: number, magnitude: number, rampInMinutes: number): number => {
  if (t < onset) return 0;
  const progress = Math.min(1, (t - onset) / rampInMinutes);
  return magnitude * progress;
};

const driftOffset = (t: number, onset: number, endAt: number, magnitude: number): number => {
  if (t < onset) return 0;
  if (t >= endAt) return magnitude;
  return magnitude * ((t - onset) / (endAt - onset));
};

// Rises linearly to a peak, then partially recovers toward the end - models a
// severe fault that's eventually caught and partially corrected before batch end.
const rampAndPartialRecover = (
  t: number,
  onset: number,
  peakAt: number,
  endAt: number,
  peakMagnitude: number,
  recoverFraction: number,
): number => {
  if (t < onset) return 0;
  if (t < peakAt) return peakMagnitude * ((t - onset) / (peakAt - onset));
  if (t >= endAt) return peakMagnitude * (1 - recoverFraction);
  const recoverProgress = (t - peakAt) / (endAt - peakAt);
  return peakMagnitude * (1 - recoverFraction * recoverProgress);
};

export const applyFault = (fault: ResolvedFault | null, t: number, b: PhaseBoundaries): FaultEffect => {
  if (!fault) return noEffect;
  const { spec, onset, magnitude, lockValue } = fault;
  const [, windowEnd] = spec.activeWindow(b);

  if (spec.shape === 'lock') {
    if (t < onset || t >= windowEnd) return noEffect;
    return { offset: {}, noiseMultiplier: {}, lockValue: { [spec.param]: lockValue as number } };
  }

  if (t < onset) return noEffect;

  if (spec.shape === 'step') {
    return { offset: { [spec.param]: stepOffset(t, onset, magnitude, spec.rampInMinutes ?? 10) }, noiseMultiplier: {}, lockValue: {} };
  }
  if (spec.shape === 'drift') {
    return { offset: { [spec.param]: driftOffset(t, onset, windowEnd, magnitude) }, noiseMultiplier: {}, lockValue: {} };
  }
  // oscillation
  return { offset: {}, noiseMultiplier: { [spec.param]: magnitude }, lockValue: {} };
};

export const applyCorrelatedFault = (
  fault: ResolvedCorrelatedFault | null,
  t: number,
): { processPressureOffset: number; flowRateOffset: number } => {
  if (!fault) return { processPressureOffset: 0, flowRateOffset: 0 };
  const pressureOffset = rampAndPartialRecover(
    t, fault.onset, fault.peakAt, fault.restrictionEnd, fault.pressurePeak, fault.recoverFraction,
  );
  const flowOffset = rampAndPartialRecover(
    t, fault.onset, fault.peakAt, fault.restrictionEnd, fault.flowPeak, fault.recoverFraction,
  );
  return { processPressureOffset: pressureOffset, flowRateOffset: flowOffset };
};
