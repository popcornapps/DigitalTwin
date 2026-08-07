import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / 'data'
MODEL_DIR = REPO_ROOT / 'models'
OUT_DIR = REPO_ROOT / 'reports' / 'paracetamol_random_forest' / 'alerting_logic'
OUT_DIR.mkdir(parents=True, exist_ok=True)

manifest = json.loads((MODEL_DIR / 'paracetamol_random_forest_manifest.json').read_text())
FEATURE_COLUMNS = manifest['feature_columns']
TARGET_COLUMNS = manifest['target_columns']
model = joblib.load(MODEL_DIR / 'paracetamol_random_forest.joblib')

# Agitator RPM stays out of scope, same reasoning as the detection-rate analysis:
# its valid comparison window (wet massing) falls almost entirely before a
# 30-minute lookback can even start.
PARAM_KEY_TO_TARGET = {
    'temperature': 'temperature_target_30min',
    'process_pressure': 'process_pressure_target_30min',
    'flow_rate': 'flow_rate_target_30min',
}
PARAM_KEY_TO_CONFIG_NAME = {
    'temperature': 'Temperature',
    'process_pressure': 'Process Pressure',
    'flow_rate': 'Flow Rate',
}
DRYING_PARAMS = list(PARAM_KEY_TO_TARGET.keys())
HORIZON_MINUTES = 30
WARNING_MARGIN_FRACTION = 0.15  # "approaching" zone = inner 15% of the band width at each edge

param_config = pd.read_csv(DATA_DIR / 'paracetamol_parameter_config.csv').set_index('parameter')
limits = {
    key: (float(param_config.loc[name, 'lower_limit']), float(param_config.loc[name, 'upper_limit']))
    for key, name in PARAM_KEY_TO_CONFIG_NAME.items()
}

batches = pd.read_csv(DATA_DIR / 'paracetamol_batches.csv').set_index('batch_id')


def ground_truth_label(batch_id):
    severity = batches.loc[batch_id, 'deviation_severity']
    return 'Normal' if pd.isna(severity) or severity == 'None' else severity


needed_columns = ['batch_id', 'split', 'elapsed_minutes'] + FEATURE_COLUMNS + TARGET_COLUMNS
full = pd.read_csv(DATA_DIR / 'paracetamol_training_dataset.csv', usecols=needed_columns)
test_df = full[full['split'] == 'test'].reset_index(drop=True)

X_test = test_df[FEATURE_COLUMNS].to_numpy()
point_preds = model.predict(X_test)
tree_preds = np.stack([tree.predict(X_test) for tree in model.estimators_])  # (n_trees, n_rows, n_targets)
target_index = {col: i for i, col in enumerate(TARGET_COLUMNS)}

for key in DRYING_PARAMS:
    idx = target_index[PARAM_KEY_TO_TARGET[key]]
    test_df[f'{key}_pred'] = point_preds[:, idx]
    test_df[f'{key}_ci_low'] = np.percentile(tree_preds[:, :, idx], 5, axis=0)
    test_df[f'{key}_ci_high'] = np.percentile(tree_preds[:, :, idx], 95, axis=0)

merged = test_df.merge(batches[['batch_duration_minutes']], left_on='batch_id', right_index=True, how='left')
target_time = merged['elapsed_minutes'] + HORIZON_MINUTES
in_window = (merged['elapsed_minutes'] >= 150) & (target_time <= merged['batch_duration_minutes'] - 40)
test_df = test_df[in_window.to_numpy()].sort_values(['batch_id', 'elapsed_minutes']).reset_index(drop=True)


def evaluate_batch(g):
    g = g.sort_values('elapsed_minutes').reset_index(drop=True)
    n = len(g)
    rule_single = np.zeros(n, dtype=bool)
    rule_consecutive3 = np.zeros(n, dtype=bool)
    rule_trend = np.zeros(n, dtype=bool)
    rule_ci_gated = np.zeros(n, dtype=bool)
    approaching_any = np.zeros(n, dtype=bool)

    for key in DRYING_PARAMS:
        lo, hi = limits[key]
        width = hi - lo
        approach_margin = width * WARNING_MARGIN_FRACTION

        pred = g[f'{key}_pred'].to_numpy()
        ci_low = g[f'{key}_ci_low'].to_numpy()
        ci_high = g[f'{key}_ci_high'].to_numpy()

        crossing = (pred < lo) | (pred > hi)
        approaching = (~crossing) & ((pred < lo + approach_margin) | (pred > hi - approach_margin))
        ci_crossing = (ci_low > hi) | (ci_high < lo)
        margin_to_breach = np.minimum(pred - lo, hi - pred)  # positive inside band, negative once crossing

        rule_single |= crossing
        rule_ci_gated |= ci_crossing
        approaching_any |= approaching

        for i in range(2, n):
            if crossing[i] and crossing[i - 1] and crossing[i - 2]:
                rule_consecutive3[i] = True

        for i in range(4, n):
            window = margin_to_breach[i - 4:i + 1]
            worsening_steps = (np.diff(window) < 0).sum()
            if worsening_steps >= 3 and window[-1] < approach_margin:
                rule_trend[i] = True

    return pd.DataFrame({
        'elapsed_minutes': g['elapsed_minutes'],
        'rule_single': rule_single,
        'rule_consecutive3': rule_consecutive3,
        'rule_trend': rule_trend,
        'rule_ci_gated': rule_ci_gated,
        'approaching': approaching_any,
    })


RULES = ['rule_single', 'rule_consecutive3', 'rule_trend', 'rule_ci_gated']
RULE_LABELS = {
    'rule_single': 'A: Single prediction crossing limit',
    'rule_consecutive3': 'B: 3 consecutive predictions crossing',
    'rule_trend': 'C: Trend continuously toward limit',
    'rule_ci_gated': 'D: CI-gated crossing (whole 90% interval outside band)',
}

batch_results = []
first_alert_times = {rule: {} for rule in RULES}
first_approach_time = {}

for batch_id, g in test_df.groupby('batch_id'):
    per_row = evaluate_batch(g)
    row = {'batch_id': batch_id, 'ground_truth': ground_truth_label(batch_id), 'scenario': batches.loc[batch_id, 'deviation_scenario']}
    for rule in RULES:
        fired = per_row[rule]
        row[rule] = bool(fired.any())
        first_alert_times[rule][batch_id] = int(per_row.loc[fired, 'elapsed_minutes'].iloc[0]) if fired.any() else None
    if per_row['approaching'].any():
        first_approach_time[batch_id] = int(per_row.loc[per_row['approaching'], 'elapsed_minutes'].iloc[0])
    else:
        first_approach_time[batch_id] = None
    batch_results.append(row)

results = pd.DataFrame(batch_results)
results['actual_positive'] = results['ground_truth'].isin(['Warning', 'Critical'])
results.to_csv(OUT_DIR / 'rule_comparison_by_batch.csv', index=False)

# Agitator-fault batches are out of scope for this pipeline (see header comment) -
# excluded from the scored comparison so they don't distort precision/recall with
# cases this alerting logic was never able to evaluate in the first place.
OUT_OF_SCOPE = {'PAR-090', 'PAR-091'}
scored = results[~results['batch_id'].isin(OUT_OF_SCOPE)].copy()


def summarize(rule):
    tp = int(((scored['actual_positive']) & (scored[rule])).sum())
    fp = int(((~scored['actual_positive']) & (scored[rule])).sum())
    fn = int(((scored['actual_positive']) & (~scored[rule])).sum())
    tn = int(((~scored['actual_positive']) & (~scored[rule])).sum())
    precision = tp / (tp + fp) if (tp + fp) else float('nan')
    recall = tp / (tp + fn) if (tp + fn) else float('nan')

    normal = scored[scored['ground_truth'] == 'Normal']
    warning = scored[scored['ground_truth'] == 'Warning']
    critical = scored[scored['ground_truth'] == 'Critical']

    return {
        'rule': RULE_LABELS[rule],
        'critical_detection': f"{critical[rule].mean():.0%} ({int(critical[rule].sum())}/{len(critical)})",
        'warning_detection': f"{warning[rule].mean():.0%} ({int(warning[rule].sum())}/{len(warning)})",
        'normal_false_alarm': f"{normal[rule].mean():.0%} ({int(normal[rule].sum())}/{len(normal)})",
        'precision': round(precision, 3),
        'recall': round(recall, 3),
        'TP': tp, 'FP': fp, 'FN': fn, 'TN': tn,
    }


summary = pd.DataFrame([summarize(rule) for rule in RULES])
summary.to_csv(OUT_DIR / 'rule_comparison_summary.csv', index=False)

print('=== Scope: excluded from scoring (agitator-RPM faults, out of pipeline scope) ===')
print(sorted(OUT_OF_SCOPE))

print('\n=== Rule comparison (in-scope test batches only) ===')
print(summary.to_string(index=False))

print('\n=== Per-batch, which rules fired ===')
print(results[['batch_id', 'ground_truth', 'scenario'] + RULES].to_string(index=False))

print('\n=== First-alert timing per rule, false-alarming Normal batches ===')
for batch_id in scored[(scored['ground_truth'] == 'Normal') & (scored['rule_single'])]['batch_id']:
    times = {rule: first_alert_times[rule][batch_id] for rule in RULES}
    print(f'  {batch_id}: {times}')

print('\n=== Warning-zone lead time vs Critical-zone crossing, PAR-081 ===')
print(f"First 'approaching' (Warning) flag: t={first_approach_time.get('PAR-081')}")
print(f"First 'crossing' (Critical, single-prediction) flag: t={first_alert_times['rule_single'].get('PAR-081')}")
print(f"First 'trend' rule flag: t={first_alert_times['rule_trend'].get('PAR-081')}")
