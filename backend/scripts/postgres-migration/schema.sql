-- PharmaTwin Phase 1: PostgreSQL schema for the 7 historical/ML CSVs.
--
-- Faithful mirror of the CSVs on purpose - no normalization, no rekeying,
-- no de-duplication of the columns batches/batch_kpis share. That work is
-- deliberately deferred until after import + verification, so verification
-- is a simple row-for-row comparison against the source CSVs.
--
-- All measured/computed floats are DOUBLE PRECISION, not NUMERIC - every one
-- of them is a pandas/numpy float64 that feeds straight into a trained
-- model's .predict(); NUMERIC would silently change the exact bit pattern.
--
-- deviation_scenario/deviation_severity are loaded as-is in this pass,
-- including the literal text "None" the CSVs use for "no deviation" -
-- converting that to real NULL is a separate, explicitly-verified cleanup
-- script run after this one, not folded in here.

BEGIN;

CREATE TABLE batches (
    batch_id                text PRIMARY KEY,
    plant                   text NOT NULL,
    is_golden_batch         boolean NOT NULL DEFAULT false,
    batch_start_datetime    timestamptz NOT NULL,
    batch_duration_minutes  integer NOT NULL CHECK (batch_duration_minutes > 0),
    deviation_scenario      text,
    deviation_severity      text,
    theoretical_output_kg   double precision NOT NULL,
    actual_output_kg        double precision NOT NULL,
    energy_kwh              double precision NOT NULL,
    assay_pct               double precision NOT NULL
);

CREATE INDEX idx_batches_plant ON batches (plant);
CREATE INDEX idx_batches_scenario ON batches (deviation_scenario) WHERE deviation_scenario IS NOT NULL AND deviation_scenario <> 'None';

CREATE TABLE batch_timeseries (
    batch_id          text NOT NULL REFERENCES batches (batch_id) ON DELETE CASCADE,
    elapsed_minutes   integer NOT NULL CHECK (elapsed_minutes >= 0),
    temperature       double precision NOT NULL,
    process_pressure  double precision NOT NULL,
    flow_rate         double precision NOT NULL,
    agitator_rpm      double precision NOT NULL,
    PRIMARY KEY (batch_id, elapsed_minutes)
);

CREATE INDEX idx_timeseries_elapsed ON batch_timeseries (elapsed_minutes);

CREATE TABLE parameters (
    parameter      text PRIMARY KEY,
    unit           text NOT NULL,
    golden_target  double precision NOT NULL,
    lower_limit    double precision NOT NULL,
    upper_limit    double precision NOT NULL CHECK (upper_limit > lower_limit)
);

CREATE TABLE golden_envelope (
    elapsed_minutes                 integer PRIMARY KEY CHECK (elapsed_minutes >= 0),
    temperature_lower_offset        double precision NOT NULL,
    temperature_upper_offset        double precision NOT NULL,
    process_pressure_lower_offset   double precision NOT NULL,
    process_pressure_upper_offset   double precision NOT NULL,
    flow_rate_lower_offset          double precision NOT NULL,
    flow_rate_upper_offset          double precision NOT NULL,
    agitator_rpm_lower_offset       double precision NOT NULL,
    agitator_rpm_upper_offset       double precision NOT NULL
);

CREATE TABLE training_dataset (
    batch_id                          text NOT NULL REFERENCES batches (batch_id) ON DELETE CASCADE,
    deviation_scenario                text,
    deviation_severity                text,
    split                              text NOT NULL CHECK (split IN ('train', 'val', 'test')),
    elapsed_minutes                    integer NOT NULL,
    temperature_current                double precision NOT NULL,
    temperature_mean_30                double precision NOT NULL,
    temperature_std_30                 double precision NOT NULL,
    temperature_min_30                 double precision NOT NULL,
    temperature_max_30                 double precision NOT NULL,
    temperature_slope_30               double precision NOT NULL,
    process_pressure_current           double precision NOT NULL,
    process_pressure_mean_30           double precision NOT NULL,
    process_pressure_std_30            double precision NOT NULL,
    process_pressure_min_30            double precision NOT NULL,
    process_pressure_max_30            double precision NOT NULL,
    process_pressure_slope_30          double precision NOT NULL,
    flow_rate_current                  double precision NOT NULL,
    flow_rate_mean_30                  double precision NOT NULL,
    flow_rate_std_30                   double precision NOT NULL,
    flow_rate_min_30                   double precision NOT NULL,
    flow_rate_max_30                   double precision NOT NULL,
    flow_rate_slope_30                 double precision NOT NULL,
    agitator_rpm_current                double precision NOT NULL,
    agitator_rpm_mean_30                double precision NOT NULL,
    agitator_rpm_std_30                 double precision NOT NULL,
    agitator_rpm_min_30                 double precision NOT NULL,
    agitator_rpm_max_30                 double precision NOT NULL,
    agitator_rpm_slope_30               double precision NOT NULL,
    temperature_target_30min           double precision NOT NULL,
    process_pressure_target_30min      double precision NOT NULL,
    flow_rate_target_30min             double precision NOT NULL,
    agitator_rpm_target_30min          double precision NOT NULL,
    PRIMARY KEY (batch_id, elapsed_minutes)
);

CREATE INDEX idx_training_split ON training_dataset (split);

CREATE TABLE batch_kpis (
    batch_id                                            text PRIMARY KEY REFERENCES batches (batch_id) ON DELETE CASCADE,
    cycle_time_hrs                                      double precision NOT NULL,
    process_stability_pct                               double precision NOT NULL,
    process_stability_in_control_pct_temperature        double precision NOT NULL,
    process_stability_in_control_pct_process_pressure   double precision NOT NULL,
    process_stability_in_control_pct_flow_rate          double precision NOT NULL,
    golden_batch_similarity_pct                         double precision NOT NULL,
    golden_batch_similarity_pct_temperature              double precision NOT NULL,
    golden_batch_similarity_pct_process_pressure         double precision NOT NULL,
    golden_batch_similarity_pct_flow_rate                double precision NOT NULL,
    fault_onset_elapsed_minutes                         double precision,
    theoretical_output_kg                               double precision NOT NULL,
    actual_output_kg                                    double precision NOT NULL,
    assay_pct                                           double precision NOT NULL,
    yield_pct                                           double precision NOT NULL,
    quality_score_pct                                   double precision NOT NULL,
    oee_availability_pct                                double precision NOT NULL,
    oee_performance_pct                                 double precision NOT NULL,
    oee_quality_pct                                     double precision NOT NULL,
    oee_pct                                             double precision NOT NULL,
    total_energy_kwh                                    double precision NOT NULL,
    sec_kwh_per_kg                                       double precision NOT NULL,
    generation_method_version                            text NOT NULL
);

CREATE TABLE synthetic_kpi_training_dataset (
    batch_id                text NOT NULL,  -- SYN-#### namespace, deliberately NOT FK'd to batches
    scenario                text NOT NULL,
    split                    text NOT NULL CHECK (split IN ('train', 'test')),
    elapsed_minutes          integer NOT NULL,
    temperature_current                double precision NOT NULL,
    temperature_mean_30                double precision NOT NULL,
    temperature_std_30                 double precision NOT NULL,
    temperature_min_30                 double precision NOT NULL,
    temperature_max_30                 double precision NOT NULL,
    temperature_slope_30               double precision NOT NULL,
    process_pressure_current           double precision NOT NULL,
    process_pressure_mean_30           double precision NOT NULL,
    process_pressure_std_30            double precision NOT NULL,
    process_pressure_min_30            double precision NOT NULL,
    process_pressure_max_30            double precision NOT NULL,
    process_pressure_slope_30          double precision NOT NULL,
    flow_rate_current                  double precision NOT NULL,
    flow_rate_mean_30                  double precision NOT NULL,
    flow_rate_std_30                   double precision NOT NULL,
    flow_rate_min_30                   double precision NOT NULL,
    flow_rate_max_30                   double precision NOT NULL,
    flow_rate_slope_30                 double precision NOT NULL,
    agitator_rpm_current                double precision NOT NULL,
    agitator_rpm_mean_30                double precision NOT NULL,
    agitator_rpm_std_30                 double precision NOT NULL,
    agitator_rpm_min_30                 double precision NOT NULL,
    agitator_rpm_max_30                 double precision NOT NULL,
    agitator_rpm_slope_30               double precision NOT NULL,
    yield_pct_final          double precision NOT NULL,
    quality_score_pct_final  double precision NOT NULL,
    sec_kwh_per_kg_final     double precision NOT NULL,
    oee_pct_final            double precision NOT NULL,
    total_energy_kwh_final   double precision NOT NULL,
    row_weight               double precision NOT NULL,
    PRIMARY KEY (batch_id, elapsed_minutes)
);

CREATE INDEX idx_synth_split ON synthetic_kpi_training_dataset (split);

COMMIT;
