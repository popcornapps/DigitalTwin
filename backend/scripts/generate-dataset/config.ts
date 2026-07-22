import type { ParameterConfigRow } from './types.ts';

export const PARAMETER_CONFIG: ParameterConfigRow[] = [
  { parameter: 'Temperature', unit: '°C', golden_target: 65.5, lower_limit: 63.0, upper_limit: 67.0 },
  { parameter: 'Process Pressure', unit: 'bar', golden_target: 1.2, lower_limit: 1.1, upper_limit: 1.3 },
  { parameter: 'Flow Rate', unit: 'L/min', golden_target: 48.5, lower_limit: 45.0, upper_limit: 52.0 },
  { parameter: 'Agitator RPM', unit: 'RPM', golden_target: 22, lower_limit: 20, upper_limit: 24 },
];

export const PLANTS = ['Hyderabad Plant', 'Pune Facility', 'Chennai Plant'];

// Nominal phase durations (minutes) for a normal batch. Actual batches jitter
// each of these by roughly +/-10% so the population isn't perfectly uniform.
export const NOMINAL_PHASE_DURATIONS = {
  dispensing: 25,
  dryMixing: 20,
  wetMassing: 25,
  transfer: 15,
  drying: 270,
  cooling: 30,
};

export const BATCH_ANCHOR_DATE = new Date('2025-01-01T08:00:00Z');
export const MINUTES_BETWEEN_BATCH_STARTS = 11 * 60;
