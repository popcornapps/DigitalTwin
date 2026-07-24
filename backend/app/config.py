from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / 'data'
MODEL_DIR = REPO_ROOT / 'models'

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

# Runtime persistence for the Process Parameter Deviation Agent's alerts -
# unlike the files above (versioned dataset artifacts), this one is mutable
# application state that changes on every tick, so it's gitignored rather
# than committed. Lets the AI Review Desk act as a true recommendation
# history that survives a backend restart, not just an in-memory list.
LIVE_ALERTS_STORE_PATH = DATA_DIR / 'live_alerts_store.json'

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
