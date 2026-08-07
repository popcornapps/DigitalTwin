"""Bulk-loads the 7 PharmaTwin historical/ML CSVs into Postgres via COPY.

Faithful mirror, on purpose: no transformation of values beyond what COPY's
own CSV parsing does natively (blank cell -> NULL, "true"/"false" -> boolean,
ISO8601 -> timestamptz). In particular, the literal text "None" that
paracetamol_batches.csv/paracetamol_training_dataset.csv use for "no
deviation" is loaded as-is, not converted to real NULL - see
cleanup_none_values.sql for that, run and verified as its own separate step.

Requires DATABASE_URL in backend/.env, e.g.:
    DATABASE_URL=postgresql://user:password@localhost:5432/digital_twin

Run from the repo root with the project's existing venv:
    .venv/bin/python backend/scripts/postgres-migration/import_csvs.py
"""
import os
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = BACKEND_ROOT / 'data'

load_dotenv(BACKEND_ROOT / '.env')

DATABASE_URL = os.environ.get('DATABASE_URL')

# (table, csv filename, column order) - column order must match the CSV
# header exactly, since COPY maps CSV columns to this list positionally.
# Listed in FK-safe order: batches first, its dependents after, the three
# independent tables last.
TABLES = [
    (
        'batches', 'paracetamol_batches.csv',
        ['batch_id', 'plant', 'is_golden_batch', 'batch_start_datetime', 'batch_duration_minutes',
         'deviation_scenario', 'deviation_severity', 'theoretical_output_kg', 'actual_output_kg',
         'energy_kwh', 'assay_pct'],
    ),
    (
        'batch_timeseries', 'paracetamol_batch_timeseries.csv',
        ['batch_id', 'elapsed_minutes', 'temperature', 'process_pressure', 'flow_rate', 'agitator_rpm'],
    ),
    (
        'training_dataset', 'paracetamol_training_dataset.csv',
        ['batch_id', 'deviation_scenario', 'deviation_severity', 'split', 'elapsed_minutes',
         'temperature_current', 'temperature_mean_30', 'temperature_std_30', 'temperature_min_30',
         'temperature_max_30', 'temperature_slope_30',
         'process_pressure_current', 'process_pressure_mean_30', 'process_pressure_std_30',
         'process_pressure_min_30', 'process_pressure_max_30', 'process_pressure_slope_30',
         'flow_rate_current', 'flow_rate_mean_30', 'flow_rate_std_30', 'flow_rate_min_30',
         'flow_rate_max_30', 'flow_rate_slope_30',
         'agitator_rpm_current', 'agitator_rpm_mean_30', 'agitator_rpm_std_30', 'agitator_rpm_min_30',
         'agitator_rpm_max_30', 'agitator_rpm_slope_30',
         'temperature_target_30min', 'process_pressure_target_30min', 'flow_rate_target_30min',
         'agitator_rpm_target_30min'],
    ),
    (
        'batch_kpis', 'paracetamol_batch_kpis.csv',
        ['batch_id', 'cycle_time_hrs', 'process_stability_pct',
         'process_stability_in_control_pct_temperature', 'process_stability_in_control_pct_process_pressure',
         'process_stability_in_control_pct_flow_rate', 'golden_batch_similarity_pct',
         'golden_batch_similarity_pct_temperature', 'golden_batch_similarity_pct_process_pressure',
         'golden_batch_similarity_pct_flow_rate', 'fault_onset_elapsed_minutes', 'theoretical_output_kg',
         'actual_output_kg', 'assay_pct', 'yield_pct', 'quality_score_pct', 'oee_availability_pct',
         'oee_performance_pct', 'oee_quality_pct', 'oee_pct', 'total_energy_kwh', 'sec_kwh_per_kg',
         'generation_method_version'],
    ),
    (
        'parameters', 'paracetamol_parameter_config.csv',
        ['parameter', 'unit', 'golden_target', 'lower_limit', 'upper_limit'],
    ),
    (
        'golden_envelope', 'paracetamol_golden_envelope.csv',
        ['elapsed_minutes', 'temperature_lower_offset', 'temperature_upper_offset',
         'process_pressure_lower_offset', 'process_pressure_upper_offset', 'flow_rate_lower_offset',
         'flow_rate_upper_offset', 'agitator_rpm_lower_offset', 'agitator_rpm_upper_offset'],
    ),
    (
        'synthetic_kpi_training_dataset', 'synthetic_kpi_training_dataset.csv',
        ['batch_id', 'scenario', 'split', 'elapsed_minutes',
         'temperature_current', 'temperature_mean_30', 'temperature_std_30', 'temperature_min_30',
         'temperature_max_30', 'temperature_slope_30',
         'process_pressure_current', 'process_pressure_mean_30', 'process_pressure_std_30',
         'process_pressure_min_30', 'process_pressure_max_30', 'process_pressure_slope_30',
         'flow_rate_current', 'flow_rate_mean_30', 'flow_rate_std_30', 'flow_rate_min_30',
         'flow_rate_max_30', 'flow_rate_slope_30',
         'agitator_rpm_current', 'agitator_rpm_mean_30', 'agitator_rpm_std_30', 'agitator_rpm_min_30',
         'agitator_rpm_max_30', 'agitator_rpm_slope_30',
         'yield_pct_final', 'quality_score_pct_final', 'sec_kwh_per_kg_final', 'oee_pct_final',
         'total_energy_kwh_final', 'row_weight'],
    ),
]

# Reverse FK order, so re-running this script is idempotent against a
# partially-loaded DB rather than failing on duplicate keys.
TRUNCATE_ORDER = [
    'training_dataset', 'batch_kpis', 'batch_timeseries', 'batches',
    'synthetic_kpi_training_dataset', 'golden_envelope', 'parameters',
]


def main() -> None:
    if not DATABASE_URL:
        sys.exit('DATABASE_URL not set - add it to backend/.env first.')

    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn:
            with conn.cursor() as cur:
                for table in TRUNCATE_ORDER:
                    cur.execute(f'TRUNCATE TABLE {table} CASCADE;')

                for table, csv_name, columns in TABLES:
                    csv_path = DATA_DIR / csv_name
                    col_list = ', '.join(columns)
                    copy_sql = (
                        f"COPY {table} ({col_list}) FROM STDIN "
                        f"WITH (FORMAT csv, HEADER true, NULL '')"
                    )
                    with open(csv_path, 'r', encoding='utf-8') as f:
                        cur.copy_expert(copy_sql, f)
                    cur.execute(f'SELECT COUNT(*) FROM {table};')
                    count = cur.fetchone()[0]
                    print(f'{table:35s} <- {csv_name:40s} {count:>8,} rows')
        print('\nImport committed successfully.')
    except Exception:
        conn.rollback()
        print('\nImport FAILED - transaction rolled back, DB left unchanged.', file=sys.stderr)
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    main()
