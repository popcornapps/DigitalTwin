export type Severity = 'None' | 'Warning' | 'Critical';

export type ScenarioType =
  | 'None'
  | 'Temperature_HeaterFault'
  | 'Temperature_HeatExchangerFouling'
  | 'Temperature_SensorDrift'
  | 'Temperature_PidHunting'
  | 'Agitator_VfdLock'
  | 'Agitator_LoadCreep'
  | 'Agitator_OverloadTrip'
  | 'Agitator_BearingWear'
  | 'Pressure_DamperSticking'
  | 'Pressure_FilterLoading'
  | 'Pressure_SealLeak'
  | 'Pressure_BlowerFluctuation'
  | 'FlowRate_FanFault'
  | 'FlowRate_FilterLoadingDecay'
  | 'FlowRate_DamperMiscalibration'
  | 'FlowRate_DuctBlockage'
  | 'Correlated_DryerRestriction';

export interface BatchPlanEntry {
  batchId: string;
  plant: string;
  isGoldenBatch: boolean;
  scenario: ScenarioType;
  severity: Severity;
}

export interface BatchRecord {
  batch_id: string;
  plant: string;
  is_golden_batch: boolean;
  batch_start_datetime: string;
  batch_duration_minutes: number;
  deviation_scenario: ScenarioType;
  deviation_severity: Severity;
}

export interface TimeseriesRow {
  batch_id: string;
  elapsed_minutes: number;
  temperature: number;
  process_pressure: number;
  flow_rate: number;
  agitator_rpm: number;
}

export interface ParameterConfigRow {
  parameter: string;
  unit: string;
  golden_target: number;
  lower_limit: number;
  upper_limit: number;
}

export interface PhaseBoundaries {
  dispensingStart: number;
  dispensingEnd: number;
  dryMixingEnd: number;
  wetMassingEnd: number;
  transferEnd: number;
  dryingEnd: number;
  coolingEnd: number;
}
