import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT))

import numpy as np
import pandas as pd

from app.state import AppState
from app.services import alert_service

OUT_DIR = BACKEND_ROOT / 'reports' / 'paracetamol_random_forest'
OUT_DIR.mkdir(parents=True, exist_ok=True)

DRYING_PARAMETER_KEYS = ('temperature', 'process_pressure', 'flow_rate')
TARGET_COLUMN = {key: f'{key}_target_30min' for key in DRYING_PARAMETER_KEYS}

SMALL_BOUNDARY_THRESHOLD_C = 1.0  # deg C past the hard limit - "just barely outside"

state = AppState()
state.load()

records = []
for batch_id in sorted(state.test_batch_ids):
    min_t, max_t = state.valid_time_range(batch_id)
    rows = state.training_df[
        (state.training_df['batch_id'] == batch_id)
        & (state.training_df['elapsed_minutes'].between(min_t, max_t))
    ].sort_values('elapsed_minutes')
    if rows.empty:
        continue

    X = rows[state.feature_columns].to_numpy()
    point_pred = state.model.predict(X)  # (n_rows, n_targets) - identical call to model_service.predict
    tree_preds = np.stack([tree.predict(X) for tree in state.model.estimators_])  # (n_trees, n_rows, n_targets)
    ci_low_all = np.percentile(tree_preds, 5, axis=0)
    ci_high_all = np.percentile(tree_preds, 95, axis=0)
    target_index = {c: i for i, c in enumerate(state.target_columns)}

    scenario = state.batches_df.loc[batch_id, 'deviation_scenario']
    scenario = 'None' if pd.isna(scenario) else scenario
    severity = state.ground_truth_severity(batch_id)

    for key in DRYING_PARAMETER_KEYS:
        lo, hi = state.parameter_limits[key]
        idx = target_index[TARGET_COLUMN[key]]
        preds = point_pred[:, idx]
        actuals = rows[TARGET_COLUMN[key]].to_numpy()
        clows = ci_low_all[:, idx]
        chighs = ci_high_all[:, idx]
        elapsed = rows['elapsed_minutes'].to_numpy()

        for i in range(len(rows)):
            predicted_alert = alert_service.classify_predicted(preds[i], lo, hi, clows[i], chighs[i])
            actual_alert = alert_service.classify_actual(actuals[i], lo, hi)
            outcome = alert_service.correctness(predicted_alert, actual_alert)
            records.append({
                'batch_id': batch_id,
                'elapsed_minutes': int(elapsed[i]),
                'parameter': key,
                'predicted': float(preds[i]),
                'actual': float(actuals[i]),
                'lower_limit': lo,
                'upper_limit': hi,
                'predicted_alert': predicted_alert,
                'actual_alert': actual_alert,
                'outcome': outcome,
                'ground_truth_scenario': scenario,
                'ground_truth_severity': severity,
            })

df = pd.DataFrame(records)
df.to_csv(OUT_DIR / 'full_evaluation_report.csv', index=False)

print(f'Evaluated {len(df)} (batch, minute, parameter) rows across {len(state.test_batch_ids)} test batches.\n')

# --- 1 & 2: per-parameter confusion counts + metrics -----------------------------
summary_rows = []
for key in DRYING_PARAMETER_KEYS:
    sub = df[df['parameter'] == key]
    counts = sub['outcome'].value_counts()
    tp, tn = counts.get('Correct catch', 0), counts.get('Correct quiet', 0)
    fn, fp = counts.get('Missed', 0), counts.get('False alarm', 0)
    total = tp + tn + fn + fp
    summary_rows.append({
        'parameter': key,
        'total_rows': total,
        'Correct catch': tp,
        'Correct quiet': tn,
        'Missed': fn,
        'False alarm': fp,
        'accuracy': (tp + tn) / total if total else float('nan'),
        'precision': tp / (tp + fp) if (tp + fp) else float('nan'),
        'recall': tp / (tp + fn) if (tp + fn) else float('nan'),
        'false_alarm_rate': fp / (fp + tn) if (fp + tn) else float('nan'),
    })
summary = pd.DataFrame(summary_rows)
summary.to_csv(OUT_DIR / 'full_evaluation_summary.csv', index=False)

print('=== 1 & 2: Confusion counts and metrics per parameter ===')
print(summary.to_string(index=False))

# --- 3: which parameter contributes the most misses -----------------------------
print('\n=== 3: Miss contribution by parameter ===')
miss_share = summary[['parameter', 'Missed']].copy()
miss_share['share_of_all_misses'] = miss_share['Missed'] / miss_share['Missed'].sum()
print(miss_share.to_string(index=False))

# --- 4: Temperature misses - small boundary crossing vs large prediction error ----
temp_misses = df[(df['parameter'] == 'temperature') & (df['outcome'] == 'Missed')].copy()
temp_misses['boundary_excess'] = temp_misses.apply(
    lambda r: max(0.0, r['lower_limit'] - r['actual'], r['actual'] - r['upper_limit']), axis=1
)
temp_misses['prediction_error'] = (temp_misses['predicted'] - temp_misses['actual']).abs()
temp_misses['cause'] = np.where(
    temp_misses['boundary_excess'] <= SMALL_BOUNDARY_THRESHOLD_C, 'Small boundary crossing', 'Large prediction error'
)

print(f'\n=== 4: Temperature miss causes (n={len(temp_misses)}), split at {SMALL_BOUNDARY_THRESHOLD_C}°C past the limit ===')
if len(temp_misses):
    cause_summary = temp_misses.groupby('cause').agg(
        count=('cause', 'size'),
        mean_boundary_excess=('boundary_excess', 'mean'),
        mean_prediction_error=('prediction_error', 'mean'),
    )
    cause_summary['share'] = cause_summary['count'] / cause_summary['count'].sum()
    print(cause_summary.to_string())
else:
    print('No Temperature misses found.')

# --- 5: Pressure misses - slow-drift (PAR-098-like) vs other causes --------------
pressure_misses = df[(df['parameter'] == 'process_pressure') & (df['outcome'] == 'Missed')].copy()
print(f'\n=== 5: Process Pressure miss breakdown by ground-truth scenario (n={len(pressure_misses)}) ===')
if len(pressure_misses):
    scenario_counts = pressure_misses['ground_truth_scenario'].value_counts()
    print(scenario_counts.to_string())
    print(f"\nBatches contributing pressure misses: {sorted(pressure_misses['batch_id'].unique())}")
else:
    print('No Process Pressure misses found.')

# --- 6: final reliability ranking -------------------------------------------------
print('\n=== 6: Parameter reliability ranking (by accuracy, then recall, then false-alarm rate) ===')
ranked = summary.sort_values(['accuracy', 'recall', 'false_alarm_rate'], ascending=[False, False, True])
print(ranked[['parameter', 'accuracy', 'recall', 'precision', 'false_alarm_rate']].to_string(index=False))

print(f'\nFull row-level report saved to {OUT_DIR / "full_evaluation_report.csv"}')
print(f'Summary saved to {OUT_DIR / "full_evaluation_summary.csv"}')
