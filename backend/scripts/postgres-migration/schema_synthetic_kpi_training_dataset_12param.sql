-- PharmaTwin: synthetic_kpi_training_dataset_12param - training data for the
-- KPI Prediction & Deviation Agent, extended to all 12 process parameters
-- (the original 4 + the 8 added in scripts/generate-support-parameters/).
-- Same row grain as before: many rows per synthetic batch (one per elapsed
-- minute), all sharing that batch's single final-outcome target - only the
-- 30-min input window differs row to row. See
-- scripts/generate-synthetic-kpi-data/generate_synthetic_kpi_data.py for how
-- this is generated and populated (a full TRUNCATE + re-insert each run).
--
-- Replaces the old CSV-only output (data/synthetic_kpi_training_dataset.csv)
-- for the 12-param version - no CSV involved at all now, matching this
-- session's other 12-param work.

BEGIN;

CREATE TABLE synthetic_kpi_training_dataset_12param (
    batch_id                                       text NOT NULL,
    scenario                                        text NOT NULL,
    split                                           text NOT NULL CHECK (split IN ('train', 'test')),
    elapsed_minutes                                 integer NOT NULL,

    temperature_current                           double precision NOT NULL,
    temperature_mean_30                           double precision NOT NULL,
    temperature_std_30                            double precision NOT NULL,
    temperature_min_30                            double precision NOT NULL,
    temperature_max_30                            double precision NOT NULL,
    temperature_slope_30                          double precision NOT NULL,
    process_pressure_current                      double precision NOT NULL,
    process_pressure_mean_30                      double precision NOT NULL,
    process_pressure_std_30                       double precision NOT NULL,
    process_pressure_min_30                       double precision NOT NULL,
    process_pressure_max_30                       double precision NOT NULL,
    process_pressure_slope_30                     double precision NOT NULL,
    flow_rate_current                             double precision NOT NULL,
    flow_rate_mean_30                             double precision NOT NULL,
    flow_rate_std_30                              double precision NOT NULL,
    flow_rate_min_30                              double precision NOT NULL,
    flow_rate_max_30                              double precision NOT NULL,
    flow_rate_slope_30                            double precision NOT NULL,
    agitator_rpm_current                          double precision NOT NULL,
    agitator_rpm_mean_30                          double precision NOT NULL,
    agitator_rpm_std_30                           double precision NOT NULL,
    agitator_rpm_min_30                           double precision NOT NULL,
    agitator_rpm_max_30                           double precision NOT NULL,
    agitator_rpm_slope_30                         double precision NOT NULL,
    inlet_air_humidity_current                    double precision NOT NULL,
    inlet_air_humidity_mean_30                    double precision NOT NULL,
    inlet_air_humidity_std_30                     double precision NOT NULL,
    inlet_air_humidity_min_30                     double precision NOT NULL,
    inlet_air_humidity_max_30                     double precision NOT NULL,
    inlet_air_humidity_slope_30                   double precision NOT NULL,
    exhaust_air_temp_current                      double precision NOT NULL,
    exhaust_air_temp_mean_30                      double precision NOT NULL,
    exhaust_air_temp_std_30                       double precision NOT NULL,
    exhaust_air_temp_min_30                       double precision NOT NULL,
    exhaust_air_temp_max_30                       double precision NOT NULL,
    exhaust_air_temp_slope_30                     double precision NOT NULL,
    filter_differential_pressure_current          double precision NOT NULL,
    filter_differential_pressure_mean_30          double precision NOT NULL,
    filter_differential_pressure_std_30           double precision NOT NULL,
    filter_differential_pressure_min_30           double precision NOT NULL,
    filter_differential_pressure_max_30           double precision NOT NULL,
    filter_differential_pressure_slope_30         double precision NOT NULL,
    shaker_vibration_frequency_current            double precision NOT NULL,
    shaker_vibration_frequency_mean_30            double precision NOT NULL,
    shaker_vibration_frequency_std_30             double precision NOT NULL,
    shaker_vibration_frequency_min_30             double precision NOT NULL,
    shaker_vibration_frequency_max_30             double precision NOT NULL,
    shaker_vibration_frequency_slope_30           double precision NOT NULL,
    product_bed_temp_current                      double precision NOT NULL,
    product_bed_temp_mean_30                      double precision NOT NULL,
    product_bed_temp_std_30                       double precision NOT NULL,
    product_bed_temp_min_30                       double precision NOT NULL,
    product_bed_temp_max_30                       double precision NOT NULL,
    product_bed_temp_slope_30                     double precision NOT NULL,
    chamber_differential_pressure_current         double precision NOT NULL,
    chamber_differential_pressure_mean_30         double precision NOT NULL,
    chamber_differential_pressure_std_30          double precision NOT NULL,
    chamber_differential_pressure_min_30          double precision NOT NULL,
    chamber_differential_pressure_max_30          double precision NOT NULL,
    chamber_differential_pressure_slope_30        double precision NOT NULL,
    ahu_damper_position_current                   double precision NOT NULL,
    ahu_damper_position_mean_30                   double precision NOT NULL,
    ahu_damper_position_std_30                    double precision NOT NULL,
    ahu_damper_position_min_30                    double precision NOT NULL,
    ahu_damper_position_max_30                    double precision NOT NULL,
    ahu_damper_position_slope_30                  double precision NOT NULL,
    compressed_air_pressure_current               double precision NOT NULL,
    compressed_air_pressure_mean_30               double precision NOT NULL,
    compressed_air_pressure_std_30                double precision NOT NULL,
    compressed_air_pressure_min_30                double precision NOT NULL,
    compressed_air_pressure_max_30                double precision NOT NULL,
    compressed_air_pressure_slope_30              double precision NOT NULL,

    yield_pct_final                                double precision NOT NULL,
    quality_score_pct_final                        double precision NOT NULL,
    sec_kwh_per_kg_final                           double precision NOT NULL,
    oee_pct_final                                  double precision NOT NULL,
    total_energy_kwh_final                         double precision NOT NULL,

    row_weight                                     double precision NOT NULL,

    PRIMARY KEY (batch_id, elapsed_minutes)
);

CREATE INDEX idx_synthetic_kpi_12param_split ON synthetic_kpi_training_dataset_12param (split);

COMMIT;
