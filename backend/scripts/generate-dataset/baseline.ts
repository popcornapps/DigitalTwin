import type { PhaseBoundaries } from './types.ts';

export const lerp = (t: number, t0: number, t1: number, v0: number, v1: number): number => {
  if (t <= t0) return v0;
  if (t >= t1) return v1;
  return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
};

// Agitator ramps to a low dry-mix speed, then to the granulation target for
// wet massing, then back down to idle before the dryer takes over.
export const agitatorBaseline = (t: number, b: PhaseBoundaries): number => {
  const rampToDryMixEnd = b.dispensingEnd + 5;
  const rampToWetMassEnd = b.dryMixingEnd + 4;
  const rampDownEnd = b.wetMassingEnd + 5;

  if (t < b.dispensingEnd) return 0;
  if (t < rampToDryMixEnd) return lerp(t, b.dispensingEnd, rampToDryMixEnd, 0, 18);
  if (t < b.dryMixingEnd) return 18;
  if (t < rampToWetMassEnd) return lerp(t, b.dryMixingEnd, rampToWetMassEnd, 18, 22);
  if (t < b.wetMassingEnd) return 22;
  if (t < rampDownEnd) return lerp(t, b.wetMassingEnd, rampDownEnd, 22, 0);
  return 0;
};

// Drying-air flow: idle until the dryer starts, then a fast ramp to target,
// held for the rest of drying, ramped back down through cooling.
export const flowRateBaseline = (t: number, b: PhaseBoundaries): number => {
  const rampUpEnd = b.transferEnd + 7;
  const rampDownEnd = b.dryingEnd + 8;

  if (t < b.transferEnd) return 0;
  if (t < rampUpEnd) return lerp(t, b.transferEnd, rampUpEnd, 0, 48.5);
  if (t < b.dryingEnd) return 48.5;
  if (t < rampDownEnd) return lerp(t, b.dryingEnd, rampDownEnd, 48.5, 0);
  return 0;
};

// Process (drying chamber) pressure: near-ambient until drying starts, then
// ramps to the controlled setpoint, held through drying, released at cooling.
export const processPressureBaseline = (t: number, b: PhaseBoundaries): number => {
  const rampUpEnd = b.transferEnd + 10;
  const rampDownEnd = b.dryingEnd + 15;

  if (t < b.transferEnd) return 1.01;
  if (t < rampUpEnd) return lerp(t, b.transferEnd, rampUpEnd, 1.0, 1.2);
  if (t < b.dryingEnd) return 1.2;
  if (t < rampDownEnd) return lerp(t, b.dryingEnd, rampDownEnd, 1.2, 1.0);
  return 1.0;
};

// Temperature: ambient -> shear-heat rise through mixing -> fast ramp to
// drying setpoint -> a mid-drying plateau/dip from evaporative cooling ->
// a slow climb as falling-rate drying begins -> ramp down through cooling.
// `currentRpm` feeds a small shear-heat bump during wet massing specifically.
export const temperatureBaseline = (t: number, b: PhaseBoundaries, currentRpm: number): number => {
  const dryingRampEnd = b.transferEnd + 40;
  const dryingPlateauEnd = dryingRampEnd + 120;

  let base: number;
  if (t < b.dispensingEnd) {
    base = 23.0;
  } else if (t < b.dryMixingEnd) {
    base = lerp(t, b.dispensingEnd, b.dryMixingEnd, 23.0, 30.0);
  } else if (t < b.wetMassingEnd) {
    base = lerp(t, b.dryMixingEnd, b.wetMassingEnd, 30.0, 34.0);
  } else if (t < b.transferEnd) {
    base = 34.0;
  } else if (t < dryingRampEnd) {
    base = lerp(t, b.transferEnd, dryingRampEnd, 34.0, 65.0);
  } else if (t < dryingPlateauEnd) {
    const dip = 1.2 * Math.sin((Math.PI * (t - dryingRampEnd)) / (dryingPlateauEnd - dryingRampEnd));
    base = 65.0 - dip;
  } else if (t < b.dryingEnd) {
    base = lerp(t, dryingPlateauEnd, b.dryingEnd, 65.0, 66.8);
  } else if (t < b.coolingEnd) {
    base = lerp(t, b.dryingEnd, b.coolingEnd, 66.8, 42.0);
  } else {
    base = 42.0;
  }

  const shearBump = t >= b.dryMixingEnd && t < b.wetMassingEnd ? 0.06 * Math.max(0, currentRpm - 18) : 0;
  return base + shearBump;
};
