export const PARAM_KEYS = ['temperature', 'process_pressure', 'flow_rate', 'agitator_rpm'] as const;
export type ParamKey = (typeof PARAM_KEYS)[number];

export const LOOKBACK_MINUTES = 30;
export const HORIZON_MINUTES = 30;

// Loosely typed on purpose - this is a data-prep artifact whose real contract
// is the CSV column list (printed by index.ts), not a compile-time shape.
export type FeatureRow = Record<string, string | number>;

export interface BatchMeta {
  batch_id: string;
  is_golden_batch: boolean;
  batch_duration_minutes: number;
  deviation_scenario: string;
  deviation_severity: string;
}

export type SplitName = 'train' | 'val' | 'test';
