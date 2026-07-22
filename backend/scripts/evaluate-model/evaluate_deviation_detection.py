import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / 'data'
MODEL_DIR = REPO_ROOT / 'models'
OUT_DIR = REPO_ROOT / 'reports' / 'paracetamol_random_forest' / 'deviation_detection'
OUT_DIR.mkdir(parents=True, exist_ok=True)

manifest = json.loads((MODEL_DIR / 'paracetamol_random_forest_manifest.json').read_text())
FEATURE_COLUMNS = manifest['feature_columns']
TARGET_COLUMNS = manifest['target_columns']

PARAM_KEY_TO_TARGET = {
    'temperature': 'temperature_target_30min',
    'process_pressure': 'process_pressure_target_30min',
    'flow_rate': 'flow_rate_target_30min',
    'agitator_rpm': 'agitator_rpm_target_30min',
}
PARAM_KEY_TO_CONFIG_NAME = {
    'temperature': 'Temperature',
    'process_pressure': 'Process Pressure',
    'flow_rate': 'Flow Rate',
    'agitator_rpm': 'Agitator RPM',
}
PARAM_KEYS = list(PARAM_KEY_TO_TARGET.keys())

model = joblib.load(MODEL_DIR / 'paracetamol_random_forest.joblib')

param_config = pd.read_csv(DATA_DIR / 'paracetamol_parameter_config.csv').set_index('parameter')
limits = {
    key: (float(param_config.loc[name, 'lower_limit']), float(param_config.loc[name, 'upper_limit']))
    for key, name in PARAM_KEY_TO_CONFIG_NAME.items()
}

batches = pd.read_csv(DATA_DIR / 'paracetamol_batches.csv').set_index('batch_id')


def ground_truth_label(batch_id):
    severity = batches.loc[batch_id, 'deviation_severity']
    # pandas parses the literal CSV string "None" as a missing value by default,
    # so a plain `== 'None'` check silently fails for every Normal batch.
    return 'Normal' if pd.isna(severity) or severity == 'None' else severity


# --- 1. Unseen test rows only --------------------------------------------------
needed_columns = ['batch_id', 'split', 'elapsed_minutes'] + FEATURE_COLUMNS + TARGET_COLUMNS
full = pd.read_csv(DATA_DIR / 'paracetamol_training_dataset.csv', usecols=needed_columns)
test_df = full[full['split'] == 'test'].reset_index(drop=True)
assert test_df['batch_id'].nunique() == 18, 'expected 18 test batches'

# --- 2. 30-min-ahead predictions vs golden operating limits ---------------------
X_test = test_df[FEATURE_COLUMNS].to_numpy()
preds = model.predict(X_test)
for i, target_col in enumerate(TARGET_COLUMNS):
    test_df[f'{target_col}_pred'] = preds[:, i]

for key in PARAM_KEYS:
    lo, hi = limits[key]
    target_col = PARAM_KEY_TO_TARGET[key]
    test_df[f'{key}_predicted_oos'] = (test_df[f'{target_col}_pred'] < lo) | (test_df[f'{target_col}_pred'] > hi)
    test_df[f'{key}_actual_oos'] = (test_df[target_col] < lo) | (test_df[target_col] > hi)

pred_oos_cols = [f'{k}_predicted_oos' for k in PARAM_KEYS]
actual_oos_cols = [f'{k}_actual_oos' for k in PARAM_KEYS]
test_df['predicted_alert_naive'] = test_df[pred_oos_cols].any(axis=1)
test_df['actual_alert_naive'] = test_df[actual_oos_cols].any(axis=1)

naive_alert_rate = test_df.groupby('batch_id')['predicted_alert_naive'].any().mean()
print('=== Sanity check: naive alert rate (limits applied across the WHOLE batch) ===')
print(f'{naive_alert_rate:.0%} of test batches get flagged - including every Normal one.')
print('Cause: Temperature/Pressure/Flow Rate golden limits only apply during the drying')
print('phase. Dispensing/mixing readings (ambient temp, near-zero flow) are legitimately')
print('outside that band and always will be, regardless of prediction quality. Restricting')
print('the check to a window where the process is actually in its drying phase below.\n')

# Temperature/Process Pressure/Flow Rate limits are only meaningful once the dryer
# has clearly reached steady state - and stay meaningful only up until the ramp-down
# into cooling begins. Both endpoints must be checked against the TARGET time
# (t+30), not the current time t - a row can have a perfectly safe "now" while its
# prediction target already falls in the legitimate end-of-drying ramp-down.
# Agitator RPM's valid comparison window (wet massing) sits almost entirely before
# the 30-minute lookback can even start, so it's excluded from this analysis rather
# than force a comparison the data can't support.
HORIZON_MINUTES = 30
merged = test_df.merge(
    batches[['batch_duration_minutes']], left_on='batch_id', right_index=True, how='left'
)
target_time = merged['elapsed_minutes'] + HORIZON_MINUTES
drying_window = (merged['elapsed_minutes'] >= 150) & (target_time <= merged['batch_duration_minutes'] - 40)
test_df['in_drying_window'] = drying_window.to_numpy()

drying_pred_cols = ['temperature_predicted_oos', 'process_pressure_predicted_oos', 'flow_rate_predicted_oos']
drying_actual_cols = ['temperature_actual_oos', 'process_pressure_actual_oos', 'flow_rate_actual_oos']
test_df['predicted_alert'] = test_df['in_drying_window'] & test_df[drying_pred_cols].any(axis=1)
test_df['actual_alert_30min_ahead'] = test_df['in_drying_window'] & test_df[drying_actual_cols].any(axis=1)

# --- Batch-level rollup ----------------------------------------------------------
rollup_rows = []
for batch_id, g in test_df.groupby('batch_id'):
    g = g.sort_values('elapsed_minutes')
    predicted_alert = bool(g['predicted_alert'].any())
    first_alert = g[g['predicted_alert']].iloc[0] if predicted_alert else None
    drying_params = ['temperature', 'process_pressure', 'flow_rate']
    triggering_params = (
        [k for k in drying_params if first_alert[f'{k}_predicted_oos']] if first_alert is not None else []
    )
    rollup_rows.append({
        'batch_id': batch_id,
        'ground_truth': ground_truth_label(batch_id),
        'scenario': batches.loc[batch_id, 'deviation_scenario'],
        'predicted_alert': predicted_alert,
        'first_alert_elapsed_minutes': int(first_alert['elapsed_minutes']) if first_alert is not None else None,
        'triggering_params': ','.join(triggering_params),
    })
rollup = pd.DataFrame(rollup_rows)
rollup['actual_positive'] = rollup['ground_truth'].isin(['Warning', 'Critical'])
rollup.to_csv(OUT_DIR / 'batch_rollup.csv', index=False)

print('=== Test batch rollup ===')
print(rollup.to_string(index=False))

# --- 3. Detection / false-alarm rates, precision/recall, confusion matrix --------
def rate_for(label):
    subset = rollup[rollup['ground_truth'] == label]
    return subset['predicted_alert'].mean() if len(subset) else float('nan'), len(subset)

crit_rate, crit_n = rate_for('Critical')
warn_rate, warn_n = rate_for('Warning')
normal_fa_rate, normal_n = rate_for('Normal')

tp = int(((rollup['actual_positive']) & (rollup['predicted_alert'])).sum())
fp = int(((~rollup['actual_positive']) & (rollup['predicted_alert'])).sum())
fn = int(((rollup['actual_positive']) & (~rollup['predicted_alert'])).sum())
tn = int(((~rollup['actual_positive']) & (~rollup['predicted_alert'])).sum())
precision = tp / (tp + fp) if (tp + fp) > 0 else float('nan')
recall = tp / (tp + fn) if (tp + fn) > 0 else float('nan')

crit_hits = int(rollup[rollup.ground_truth == 'Critical'].predicted_alert.sum())
warn_hits = int(rollup[rollup.ground_truth == 'Warning'].predicted_alert.sum())
normal_hits = int(rollup[rollup.ground_truth == 'Normal'].predicted_alert.sum())

print('\n=== Detection rates ===')
print(f'Critical batch detection rate: {crit_rate:.1%}  ({crit_hits}/{crit_n})')
print(f'Warning batch detection rate:  {warn_rate:.1%}  ({warn_hits}/{warn_n})')
print(f'Normal false alarm rate:       {normal_fa_rate:.1%}  ({normal_hits}/{normal_n})')

print('\n=== Precision / Recall (batch-level, positive = Warning or Critical) ===')
print(f'TP={tp}  FP={fp}  FN={fn}  TN={tn}')
print(f'Precision: {precision:.3f}')
print(f'Recall:    {recall:.3f}')

print('\n=== Confusion matrix (rows=ground truth, cols=predicted) ===')
confusion = pd.crosstab(rollup['ground_truth'], rollup['predicted_alert'].map({True: 'Alert', False: 'No Alert'}))
confusion = confusion.reindex(index=['Normal', 'Warning', 'Critical'], columns=['Alert', 'No Alert'], fill_value=0)
print(confusion)
confusion.to_csv(OUT_DIR / 'confusion_matrix.csv')

# --- 4. Example batches -----------------------------------------------------------
correctly_detected = rollup[(rollup['actual_positive']) & (rollup['predicted_alert'])].sort_values('ground_truth', ascending=False)
missed = rollup[(rollup['actual_positive']) & (~rollup['predicted_alert'])]
clean_normal = rollup[(~rollup['actual_positive']) & (~rollup['predicted_alert'])]

print('\n=== Example: correctly detected fault batch ===')
print(correctly_detected.head(1).to_string(index=False) if len(correctly_detected) else 'none found')

print('\n=== Example: missed fault batch ===')
print(missed.head(1).to_string(index=False) if len(missed) else 'none found')

print('\n=== Example: normal batch, no false alarm ===')
print(clean_normal.head(1).to_string(index=False) if len(clean_normal) else 'none found')

# --- 5. Timeline for one detected deviation --------------------------------------
if len(correctly_detected):
    example = correctly_detected.iloc[0]
    batch_id = example['batch_id']
    trigger_param = example['triggering_params'].split(',')[0]
    alert_t = example['first_alert_elapsed_minutes']
    lo, hi = limits[trigger_param]
    target_col = PARAM_KEY_TO_TARGET[trigger_param]

    g = test_df[test_df['batch_id'] == batch_id].sort_values('elapsed_minutes')
    window = g[(g['elapsed_minutes'] >= alert_t - 20) & (g['elapsed_minutes'] <= alert_t + 20)]

    timeline = pd.DataFrame({
        'elapsed_minutes': window['elapsed_minutes'],
        'current_value': window[f'{trigger_param}_current'],
        'predicted_t+30': window[f'{target_col}_pred'].round(2),
        'actual_t+30': window[target_col],
        'lower_limit': lo,
        'upper_limit': hi,
        'predicted_alert': window[f'{trigger_param}_predicted_oos'],
        'actual_oos_at_t+30': window[f'{trigger_param}_actual_oos'],
    })
    timeline.to_csv(OUT_DIR / f'timeline_{batch_id}_{trigger_param}.csv', index=False)

    print(f"\n=== Timeline: {batch_id}, parameter='{trigger_param}', first predicted alert at t={alert_t} ===")
    print(timeline.to_string(index=False))

    # Same steady-state-drying restriction as the detection evaluation above -
    # otherwise the dispensing-phase ambient reading at t=0 gets misread as "the
    # deviation," the same trap that produced the nonsensical result before the fix.
    batch_duration = batches.loc[batch_id, 'batch_duration_minutes']
    raw = pd.read_csv(DATA_DIR / 'paracetamol_batch_timeseries.csv')
    raw_batch = raw[raw['batch_id'] == batch_id].sort_values('elapsed_minutes')
    raw_batch = raw_batch[(raw_batch['elapsed_minutes'] >= 150) & (raw_batch['elapsed_minutes'] <= batch_duration - 40)]
    raw_oos = (raw_batch[trigger_param] < lo) | (raw_batch[trigger_param] > hi)
    true_first_breach = raw_batch.loc[raw_oos, 'elapsed_minutes'].min() if raw_oos.any() else None

    print(f'\nModel first raised an alert at t={alert_t} (predicting the value at t={alert_t + 30})')
    print(f'The raw signal itself first left the golden operating band (within the steady-state drying window) at t={true_first_breach}')
    if true_first_breach is not None:
        print(f'Effective lead time provided: {true_first_breach - alert_t} minutes')
