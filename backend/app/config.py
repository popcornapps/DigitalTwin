from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_ROOT / 'data'
MODEL_DIR = BACKEND_ROOT / 'models'

MODEL_PATH = MODEL_DIR / 'paracetamol_random_forest.joblib'
MANIFEST_PATH = MODEL_DIR / 'paracetamol_random_forest_manifest.json'
BATCHES_CSV = DATA_DIR / 'paracetamol_batches.csv'
TIMESERIES_CSV = DATA_DIR / 'paracetamol_batch_timeseries.csv'
TRAINING_DATASET_CSV = DATA_DIR / 'paracetamol_training_dataset.csv'
PARAMETER_CONFIG_CSV = DATA_DIR / 'paracetamol_parameter_config.csv'
GOLDEN_ENVELOPE_CSV = DATA_DIR / 'paracetamol_golden_envelope.csv'
FAULT_SIGNATURES_PATH = DATA_DIR / 'paracetamol_fault_signatures.json'
BATCH_KPIS_CSV = DATA_DIR / 'paracetamol_batch_kpis.csv'
BATCH_KPIS_MANIFEST_PATH = DATA_DIR / 'paracetamol_batch_kpis_manifest.json'

LOOKBACK_MINUTES = 30
HORIZON_MINUTES = 30

# Same restriction validated in the deviation-detection analysis: the golden
# operating band only applies once the process has clearly settled into
# steady-state drying, and only until the end-of-drying ramp-down begins.
# Reused here deliberately, not re-derived - this is the fix for the exact
# "100% of batches falsely flagged" bug found earlier, and the API must not
# reintroduce it by allowing predictions outside this window.
DRYING_WINDOW_START_MINUTES = 150
DRYING_WINDOW_END_BUFFER_MINUTES = 40

WARNING_MARGIN_FRACTION = 0.15

CORS_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

DRYING_PARAMETER_KEYS = ('temperature', 'process_pressure', 'flow_rate')
ALL_PARAMETER_KEYS = ('temperature', 'process_pressure', 'flow_rate', 'agitator_rpm')

PARAMETER_CONFIG_NAMES = {
    'temperature': 'Temperature',
    'process_pressure': 'Process Pressure',
    'flow_rate': 'Flow Rate',
    'agitator_rpm': 'Agitator RPM',
}
# Same mapping, used for two different purposes: PARAMETER_CONFIG_NAMES looks
# up rows in parameter_config.csv (indexed by this display name);
# PARAMETER_LABELS is the human-readable label sent to the frontend.
PARAMETER_LABELS = PARAMETER_CONFIG_NAMES
PARAMETER_UNITS = {
    'temperature': '°C',
    'process_pressure': 'bar',
    'flow_rate': 'L/min',
    'agitator_rpm': 'RPM',
}

# Plant-manager KPI aggregation: shift/day/month rollups over historical
# batches (data_service.get_plant_period_kpis). Two fixed 12-hour shifts; a
# batch is attributed to a shift/day/month bucket solely by its
# batch_start_datetime - never split, even if batch_duration_minutes runs
# past a boundary. Hour boundaries below are in the PLANT's local time
# (IST) - batch_start_datetime is stored/parsed as UTC (real for live
# batches via datetime.now(timezone.utc)) and must be shifted by
# PLANT_TIMEZONE_UTC_OFFSET_MINUTES before these hour checks are applied,
# or "Current Shift" drifts against the plant's actual wall clock.
DAY_SHIFT_START_HOUR = 6     # 06:00 IST - Day Shift starts
NIGHT_SHIFT_START_HOUR = 18  # 18:00 IST - Night Shift starts, crosses midnight
DAY_SHIFT_LABEL = 'Day Shift'
NIGHT_SHIFT_LABEL = 'Night Shift'
PLANT_PERIOD_GROUP_BY_VALUES = ('shift', 'day', 'month')

# Hyderabad Plant runs on IST (UTC+5:30) - applied only to the shift/day/
# month bucketing math (get_plant_period_kpis/_current_bucket below);
# batch_start_datetime itself stays stored as real UTC (a timestamptz
# column), only the bucketing conversion happens at read time.
PLANT_TIMEZONE_UTC_OFFSET_MINUTES = 330
