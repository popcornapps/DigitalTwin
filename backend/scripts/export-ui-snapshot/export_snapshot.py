import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / 'data'
MODEL_DIR = REPO_ROOT / 'models'
OUT_TS_PATH = REPO_ROOT / 'src' / 'lib' / 'deviationPredictionSnapshot.ts'

BATCH_ID = 'PAR-081'
T = 228
HORIZON = 30

manifest = json.loads((MODEL_DIR / 'paracetamol_random_forest_manifest.json').read_text())
FEATURE_COLUMNS = manifest['feature_columns']
TARGET_COLUMNS = manifest['target_columns']
model = joblib.load(MODEL_DIR / 'paracetamol_random_forest.joblib')

PARAM_KEY_TO_TARGET = {
    'temperature': 'temperature_target_30min',
    'process_pressure': 'process_pressure_target_30min',
    'flow_rate': 'flow_rate_target_30min',
}
PARAM_KEY_TO_CONFIG_NAME = {
    'temperature': 'Temperature',
    'process_pressure': 'Process Pressure',
    'flow_rate': 'Flow Rate',
    'agitator_rpm': 'Agitator RPM',
}
PARAM_LABELS = {
    'temperature': 'Temperature',
    'process_pressure': 'Process Pressure',
    'flow_rate': 'Flow Rate',
    'agitator_rpm': 'Agitator RPM',
}
UNITS = {'temperature': '°C', 'process_pressure': 'bar', 'flow_rate': 'L/min', 'agitator_rpm': 'RPM'}
WARNING_MARGIN_FRACTION = 0.15

param_config = pd.read_csv(DATA_DIR / 'paracetamol_parameter_config.csv').set_index('parameter')
limits = {
    key: (float(param_config.loc[name, 'lower_limit']), float(param_config.loc[name, 'upper_limit']))
    for key, name in PARAM_KEY_TO_CONFIG_NAME.items()
}

batches = pd.read_csv(DATA_DIR / 'paracetamol_batches.csv').set_index('batch_id')
raw = pd.read_csv(DATA_DIR / 'paracetamol_batch_timeseries.csv')
raw_row = raw[(raw['batch_id'] == BATCH_ID) & (raw['elapsed_minutes'] == T)].iloc[0]

full = pd.read_csv(
    DATA_DIR / 'paracetamol_training_dataset.csv',
    usecols=['batch_id', 'elapsed_minutes'] + FEATURE_COLUMNS + TARGET_COLUMNS,
)
feat_row = full[(full['batch_id'] == BATCH_ID) & (full['elapsed_minutes'] == T)].iloc[0]

X = feat_row[FEATURE_COLUMNS].to_numpy().reshape(1, -1)
point_pred = model.predict(X)[0]
tree_preds = np.stack([tree.predict(X) for tree in model.estimators_])[:, 0, :]  # (n_trees, n_targets)
ci_low_all = np.percentile(tree_preds, 5, axis=0)
ci_high_all = np.percentile(tree_preds, 95, axis=0)
target_index = {col: i for i, col in enumerate(TARGET_COLUMNS)}


def classify(predicted, lo, hi, ci_low, ci_high):
    if ci_low > hi or ci_high < lo:
        return 'Critical'
    width = hi - lo
    margin = width * WARNING_MARGIN_FRACTION
    if predicted < lo + margin or predicted > hi - margin:
        return 'Warning'
    return 'Normal'


parameters = []
for key in ['temperature', 'process_pressure', 'flow_rate']:
    lo, hi = limits[key]
    idx = target_index[PARAM_KEY_TO_TARGET[key]]
    predicted = round(float(point_pred[idx]), 2)
    ci_low = round(float(ci_low_all[idx]), 2)
    ci_high = round(float(ci_high_all[idx]), 2)
    current = round(float(raw_row[key]), 2)
    parameters.append({
        'key': key,
        'label': PARAM_LABELS[key],
        'unit': UNITS[key],
        'current': current,
        'predicted30Min': predicted,
        'ciLow': ci_low,
        'ciHigh': ci_high,
        'lowerLimit': lo,
        'upperLimit': hi,
        'alertLevel': classify(predicted, lo, hi, ci_low, ci_high),
        'applicable': True,
    })

# Agitator RPM sits outside deviation-prediction scope during drying (see
# reports/paracetamol_random_forest/deviation_detection) - shown as current-only.
rpm_lo, rpm_hi = limits['agitator_rpm']
parameters.append({
    'key': 'agitator_rpm',
    'label': PARAM_LABELS['agitator_rpm'],
    'unit': UNITS['agitator_rpm'],
    'current': round(float(raw_row['agitator_rpm']), 2),
    'predicted30Min': None,
    'ciLow': None,
    'ciHigh': None,
    'lowerLimit': rpm_lo,
    'upperLimit': rpm_hi,
    'alertLevel': 'Not Applicable',
    'applicable': False,
})

batch_meta = batches.loc[BATCH_ID]
snapshot = {
    'batchId': BATCH_ID,
    'plant': batch_meta['plant'],
    'product': 'Paracetamol 500mg',
    'elapsedMinutes': T,
    'horizonMinutes': HORIZON,
    'batchDurationMinutes': int(batch_meta['batch_duration_minutes']),
    'groundTruthScenario': batch_meta['deviation_scenario'],
    'groundTruthSeverity': batch_meta['deviation_severity'] if pd.notna(batch_meta['deviation_severity']) else 'None',
    'modelVersion': manifest['hyperparameters'],
    'parameters': parameters,
}

print(json.dumps(snapshot, indent=2))

ts_lines = [
    "// Real snapshot pulled from the trained Random Forest model (models/paracetamol_random_forest.joblib)",
    "// against actual generated batch data - not a hand-authored mock. Regenerate with:",
    "//   .venv/bin/python scripts/export-ui-snapshot/export_snapshot.py",
    "",
    "export interface DeviationParameter {",
    "  key: string;",
    "  label: string;",
    "  unit: string;",
    "  current: number;",
    "  predicted30Min: number | null;",
    "  ciLow: number | null;",
    "  ciHigh: number | null;",
    "  lowerLimit: number;",
    "  upperLimit: number;",
    "  alertLevel: 'Normal' | 'Warning' | 'Critical' | 'Not Applicable';",
    "  applicable: boolean;",
    "}",
    "",
    "export interface DeviationPredictionSnapshot {",
    "  batchId: string;",
    "  plant: string;",
    "  product: string;",
    "  elapsedMinutes: number;",
    "  horizonMinutes: number;",
    "  batchDurationMinutes: number;",
    "  groundTruthScenario: string;",
    "  groundTruthSeverity: string;",
    "  parameters: DeviationParameter[];",
    "}",
    "",
    f"export const deviationPredictionSnapshot: DeviationPredictionSnapshot = {json.dumps({k: v for k, v in snapshot.items() if k != 'modelVersion'}, indent=2)};",
    "",
]
OUT_TS_PATH.write_text('\n'.join(ts_lines))
print(f'\nWrote {OUT_TS_PATH}')
