import { NOMINAL_PHASE_DURATIONS } from './config.ts';
import type { PhaseBoundaries } from './types.ts';
import type { SeededRandom } from './rng.ts';

const jitter = (rng: SeededRandom, minutes: number): number => Math.round(minutes * rng.uniform(0.9, 1.1));

export const buildPhaseBoundaries = (rng: SeededRandom): PhaseBoundaries => {
  const dispensing = jitter(rng, NOMINAL_PHASE_DURATIONS.dispensing);
  const dryMixing = jitter(rng, NOMINAL_PHASE_DURATIONS.dryMixing);
  const wetMassing = jitter(rng, NOMINAL_PHASE_DURATIONS.wetMassing);
  const transfer = jitter(rng, NOMINAL_PHASE_DURATIONS.transfer);
  const drying = jitter(rng, NOMINAL_PHASE_DURATIONS.drying);
  const cooling = jitter(rng, NOMINAL_PHASE_DURATIONS.cooling);

  const dispensingEnd = dispensing;
  const dryMixingEnd = dispensingEnd + dryMixing;
  const wetMassingEnd = dryMixingEnd + wetMassing;
  const transferEnd = wetMassingEnd + transfer;
  const dryingEnd = transferEnd + drying;
  const coolingEnd = dryingEnd + cooling;

  return { dispensingStart: 0, dispensingEnd, dryMixingEnd, wetMassingEnd, transferEnd, dryingEnd, coolingEnd };
};

export const isAgitatorRunning = (t: number, b: PhaseBoundaries): boolean =>
  t >= b.dispensingEnd && t < b.transferEnd;

export const isDryerRunning = (t: number, b: PhaseBoundaries): boolean => t >= b.transferEnd && t < b.coolingEnd;
