-- PharmaTwin: training_dataset_12param - same shape/purpose as the existing
-- `training_dataset` table (30-min rolling-window features + 30-min-ahead
-- targets, one row per batch-minute), extended to all 12 process parameters
-- (the original 4 + the 8 added in batch_support_timeseries). Kept as its
-- own table rather than altering `training_dataset` in place, so the
-- currently-running 4-param model's training data is left untouched.
--
-- Populated by scripts/train-model/train_random_forest_12param.py.

BEGIN;

CREATE TABLE training_dataset_12param (
    batch_id                                    text NOT NULL REFERENCES batches (batch_id) ON DELETE CASCADE,
    deviation_scenario                          text,
    deviation_severity                          text,
    split                                       text NOT NULL CHECK (split IN ('train', 'val', 'test')),
    elapsed_minutes                             integer NOT NULL,

    temperature_current                         double precision NOT NULL,
    temperature_mean_30                         double precision NOT NULL,
    temperature_std_30                          double precision NOT NULL,
    temperature_min_30                          double precision NOT NULL,
    temperature_max_30                          double precision NOT NULL,
    temperature_slope_30                        double precision NOT NULL,

    process_pressure_current                    double precision NOT NULL,
    process_pressure_mean_30                    double precision NOT NULL,
    process_pressure_std_30                     double precision NOT NULL,
    process_pressure_min_30                     double precision NOT NULL,
    process_pressure_max_30                     double precision NOT NULL,
    process_pressure_slope_30                   double precision NOT NULL,

    flow_rate_current                           double precision NOT NULL,
    flow_rate_mean_30                           double precision NOT NULL,
    flow_rate_std_30                            double precision NOT NULL,
    flow_rate_min_30                            double precision NOT NULL,
    flow_rate_max_30                            double precision NOT NULL,
    flow_rate_slope_30                          double precision NOT NULL,

    agitator_rpm_current                        double precision NOT NULL,
    agitator_rpm_mean_30                        double precision NOT NULL,
    agitator_rpm_std_30                         double precision NOT NULL,
    agitator_rpm_min_30                         double precision NOT NULL,
    agitator_rpm_max_30                         double precision NOT NULL,
    agitator_rpm_slope_30                       double precision NOT NULL,

    inlet_air_humidity_current                  double precision NOT NULL,
    inlet_air_humidity_mean_30                  double precision NOT NULL,
    inlet_air_humidity_std_30                   double precision NOT NULL,
    inlet_air_humidity_min_30                   double precision NOT NULL,
    inlet_air_humidity_max_30                   double precision NOT NULL,
    inlet_air_humidity_slope_30                 double precision NOT NULL,

    exhaust_air_temp_current                    double precision NOT NULL,
    exhaust_air_temp_mean_30                    double precision NOT NULL,
    exhaust_air_temp_std_30                     double precision NOT NULL,
    exhaust_air_temp_min_30                     double precision NOT NULL,
    exhaust_air_temp_max_30                     double precision NOT NULL,
    exhaust_air_temp_slope_30                   double precision NOT NULL,

    filter_differential_pressure_current        double precision NOT NULL,
    filter_differential_pressure_mean_30        double precision NOT NULL,
    filter_differential_pressure_std_30         double precision NOT NULL,
    filter_differential_pressure_min_30         double precision NOT NULL,
    filter_differential_pressure_max_30         double precision NOT NULL,
    filter_differential_pressure_slope_30       double precision NOT NULL,

    shaker_vibration_frequency_current          double precision NOT NULL,
    shaker_vibration_frequency_mean_30          double precision NOT NULL,
    shaker_vibration_frequency_std_30           double precision NOT NULL,
    shaker_vibration_frequency_min_30           double precision NOT NULL,
    shaker_vibration_frequency_max_30           double precision NOT NULL,
    shaker_vibration_frequency_slope_30         double precision NOT NULL,

    product_bed_temp_current                    double precision NOT NULL,
    product_bed_temp_mean_30                    double precision NOT NULL,
    product_bed_temp_std_30                     double precision NOT NULL,
    product_bed_temp_min_30                     double precision NOT NULL,
    product_bed_temp_max_30                     double precision NOT NULL,
    product_bed_temp_slope_30                   double precision NOT NULL,

    chamber_differential_pressure_current       double precision NOT NULL,
    chamber_differential_pressure_mean_30       double precision NOT NULL,
    chamber_differential_pressure_std_30        double precision NOT NULL,
    chamber_differential_pressure_min_30        double precision NOT NULL,
    chamber_differential_pressure_max_30        double precision NOT NULL,
    chamber_differential_pressure_slope_30      double precision NOT NULL,

    ahu_damper_position_current                 double precision NOT NULL,
    ahu_damper_position_mean_30                 double precision NOT NULL,
    ahu_damper_position_std_30                  double precision NOT NULL,
    ahu_damper_position_min_30                  double precision NOT NULL,
    ahu_damper_position_max_30                  double precision NOT NULL,
    ahu_damper_position_slope_30                double precision NOT NULL,

    compressed_air_pressure_current             double precision NOT NULL,
    compressed_air_pressure_mean_30             double precision NOT NULL,
    compressed_air_pressure_std_30              double precision NOT NULL,
    compressed_air_pressure_min_30              double precision NOT NULL,
    compressed_air_pressure_max_30              double precision NOT NULL,
    compressed_air_pressure_slope_30            double precision NOT NULL,

    temperature_target_30min                    double precision NOT NULL,
    process_pressure_target_30min               double precision NOT NULL,
    flow_rate_target_30min                      double precision NOT NULL,
    agitator_rpm_target_30min                   double precision NOT NULL,
    inlet_air_humidity_target_30min             double precision NOT NULL,
    exhaust_air_temp_target_30min               double precision NOT NULL,
    filter_differential_pressure_target_30min   double precision NOT NULL,
    shaker_vibration_frequency_target_30min     double precision NOT NULL,
    product_bed_temp_target_30min               double precision NOT NULL,
    chamber_differential_pressure_target_30min  double precision NOT NULL,
    ahu_damper_position_target_30min            double precision NOT NULL,
    compressed_air_pressure_target_30min        double precision NOT NULL,

    PRIMARY KEY (batch_id, elapsed_minutes)
);

CREATE INDEX idx_training_dataset_12param_split ON training_dataset_12param (split);

COMMIT;
