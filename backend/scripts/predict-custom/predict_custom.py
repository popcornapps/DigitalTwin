import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / 'data'
MODEL_DIR = REPO_ROOT / 'models'

manifest = json.loads((MODEL_DIR / 'paracetamol_random_forest_manifest.json').read_text())
FEATURE_COLUMNS = manifest['feature_columns']
TARGET_COLUMNS = manifest['target_columns']
model = joblib.load(MODEL_DIR / 'paracetamol_random_forest.joblib')

PARAMS = {
    'temperature': {'flag': 'temperature', 'target': 'temperature_target_30min', 'unit': '°C', 'config_name': 'Temperature'},
    'process_pressure': {'flag': 'pressure', 'target': 'process_pressure_target_30min', 'unit': 'bar', 'config_name': 'Process Pressure'},
    'flow_rate': {'flag': 'flow', 'target': 'flow_rate_target_30min', 'unit': 'L/min', 'config_name': 'Flow Rate'},
    'agitator_rpm': {'flag': 'rpm', 'target': 'agitator_rpm_target_30min', 'unit': 'RPM', 'config_name': 'Agitator RPM'},
}
STATS = ['current', 'mean_30', 'std_30', 'min_30', 'max_30', 'slope_30']

param_config = pd.read_csv(DATA_DIR / 'paracetamol_parameter_config.csv').set_index('parameter')
limits = {
    key: (float(param_config.loc[p['config_name'], 'lower_limit']), float(param_config.loc[p['config_name'], 'upper_limit']))
    for key, p in PARAMS.items()
}
WARNING_MARGIN_FRACTION = 0.15


def build_parser():
    parser = argparse.ArgumentParser(
        description='Feed your own current process readings into the trained Random Forest and see its 30-minute-ahead prediction.',
    )
    parser.add_argument('--elapsed-minutes', type=float, default=200, help='How far into the batch (default: 200)')
    for key, p in PARAMS.items():
        parser.add_argument(f'--{p["flag"]}-current', type=float, required=True, help=f'Current {p["config_name"]} reading ({p["unit"]}) - required')
        for stat in STATS[1:]:
            parser.add_argument(f'--{p["flag"]}-{stat.replace("_", "-")}', type=float, default=None,
                                 help=f'{p["config_name"]} {stat} over the last 30 min - defaults to "flat at current" if omitted')
    return parser


def resolve_features(args):
    row = {'elapsed_minutes': args.elapsed_minutes}
    for key, p in PARAMS.items():
        current = getattr(args, f'{p["flag"]}_current')
        row[f'{key}_current'] = current
        row[f'{key}_mean_30'] = getattr(args, f'{p["flag"]}_mean_30') or current
        row[f'{key}_std_30'] = getattr(args, f'{p["flag"]}_std_30') or 0.0
        row[f'{key}_min_30'] = getattr(args, f'{p["flag"]}_min_30') or current
        row[f'{key}_max_30'] = getattr(args, f'{p["flag"]}_max_30') or current
        row[f'{key}_slope_30'] = getattr(args, f'{p["flag"]}_slope_30') or 0.0
    return row


def classify(predicted, lo, hi, ci_low, ci_high):
    if ci_low > hi or ci_high < lo:
        return 'Critical'
    margin = (hi - lo) * WARNING_MARGIN_FRACTION
    if predicted < lo + margin or predicted > hi - margin:
        return 'Warning'
    return 'Normal'


def main():
    args = build_parser().parse_args()
    feature_row = resolve_features(args)
    defaulted = [
        f'{key}_{stat}' for key, p in PARAMS.items() for stat in STATS[1:]
        if getattr(args, f'{p["flag"]}_{stat}') is None
    ]

    X = np.array([[feature_row[col] for col in FEATURE_COLUMNS]])
    point_pred = model.predict(X)[0]
    tree_preds = np.stack([tree.predict(X) for tree in model.estimators_])[:, 0, :]
    ci_low_all = np.percentile(tree_preds, 5, axis=0)
    ci_high_all = np.percentile(tree_preds, 95, axis=0)
    target_index = {col: i for i, col in enumerate(TARGET_COLUMNS)}

    print(f"\nInput: elapsed_minutes={args.elapsed_minutes}")
    if defaulted:
        print(f"(Assumed 'flat at current value' for: {', '.join(defaulted)} - pass your own to override)\n")

    print(f"{'Parameter':<18}{'Current':>10}{'Predicted+30m':>16}{'90% CI':>18}{'Golden Limit':>16}  Alert")
    for key, p in PARAMS.items():
        if key == 'agitator_rpm':
            print(f"{p['config_name']:<18}{feature_row['agitator_rpm_current']:>10.2f}{'n/a (out of scope during drying)':>50}")
            continue
        lo, hi = limits[key]
        idx = target_index[p['target']]
        predicted = round(float(point_pred[idx]), 2)
        ci_low = round(float(ci_low_all[idx]), 2)
        ci_high = round(float(ci_high_all[idx]), 2)
        alert = classify(predicted, lo, hi, ci_low, ci_high)
        print(f"{p['config_name']:<18}{feature_row[f'{key}_current']:>10.2f}{predicted:>16.2f}"
              f"{f'{ci_low} - {ci_high}':>18}{f'{lo} - {hi}':>16}  {alert}")
    print()


if __name__ == '__main__':
    main()
