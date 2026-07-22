import json
import time
from pathlib import Path

import joblib
import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = REPO_ROOT / 'data' / 'paracetamol_training_dataset.csv'
MODEL_DIR = REPO_ROOT / 'models'
REPORT_DIR = REPO_ROOT / 'reports' / 'paracetamol_random_forest'

FEATURE_COLUMNS = [
    'elapsed_minutes',
    'temperature_current', 'temperature_mean_30', 'temperature_std_30', 'temperature_min_30', 'temperature_max_30', 'temperature_slope_30',
    'process_pressure_current', 'process_pressure_mean_30', 'process_pressure_std_30', 'process_pressure_min_30', 'process_pressure_max_30', 'process_pressure_slope_30',
    'flow_rate_current', 'flow_rate_mean_30', 'flow_rate_std_30', 'flow_rate_min_30', 'flow_rate_max_30', 'flow_rate_slope_30',
    'agitator_rpm_current', 'agitator_rpm_mean_30', 'agitator_rpm_std_30', 'agitator_rpm_min_30', 'agitator_rpm_max_30', 'agitator_rpm_slope_30',
]
TARGET_COLUMNS = [
    'temperature_target_30min',
    'process_pressure_target_30min',
    'flow_rate_target_30min',
    'agitator_rpm_target_30min',
]
TARGET_LABELS = {
    'temperature_target_30min': 'Temperature (°C)',
    'process_pressure_target_30min': 'Process Pressure (bar)',
    'flow_rate_target_30min': 'Flow Rate (L/min)',
    'agitator_rpm_target_30min': 'Agitator RPM',
}

CANDIDATE_CONFIGS = [
    {'n_estimators': 100, 'max_depth': None},
    {'n_estimators': 200, 'max_depth': None},
    {'n_estimators': 200, 'max_depth': 12},
    {'n_estimators': 400, 'max_depth': 20},
]

RANDOM_STATE = 42


def load_splits():
    needed_columns = ['split'] + FEATURE_COLUMNS + TARGET_COLUMNS
    df = pd.read_csv(DATA_PATH, usecols=needed_columns)
    return df[df['split'] == 'train'], df[df['split'] == 'val'], df[df['split'] == 'test']


def to_xy(df):
    return df[FEATURE_COLUMNS].to_numpy(), df[TARGET_COLUMNS].to_numpy()


def select_model(X_train, y_train, X_val, y_val):
    print('Model selection (candidates fit on train, scored on validation only):')
    best_config, best_score = None, -np.inf
    for config in CANDIDATE_CONFIGS:
        model = RandomForestRegressor(random_state=RANDOM_STATE, n_jobs=-1, **config)
        model.fit(X_train, y_train)
        preds = model.predict(X_val)
        per_target_r2 = [r2_score(y_val[:, i], preds[:, i]) for i in range(len(TARGET_COLUMNS))]
        mean_r2 = float(np.mean(per_target_r2))
        print(f"  {config} -> mean val R2={mean_r2:.4f}  per-target={[f'{v:.3f}' for v in per_target_r2]}")
        if mean_r2 > best_score:
            best_score, best_config = mean_r2, config
    print(f'\nSelected config: {best_config} (mean val R2={best_score:.4f})\n')
    return best_config


def evaluate(model, X_test, y_test):
    preds = model.predict(X_test)
    rows = []
    for i, col in enumerate(TARGET_COLUMNS):
        rows.append({
            'target': col,
            'MAE': mean_absolute_error(y_test[:, i], preds[:, i]),
            'RMSE': float(np.sqrt(mean_squared_error(y_test[:, i], preds[:, i]))),
            'R2': r2_score(y_test[:, i], preds[:, i]),
        })
    return pd.DataFrame(rows), preds


def plot_predicted_vs_actual(y_test, preds):
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    for i, col in enumerate(TARGET_COLUMNS):
        actual, predicted = y_test[:, i], preds[:, i]
        fig, ax = plt.subplots(figsize=(5, 5))
        ax.scatter(actual, predicted, s=6, alpha=0.3, color='#3b82f6')
        lo, hi = min(actual.min(), predicted.min()), max(actual.max(), predicted.max())
        ax.plot([lo, hi], [lo, hi], color='#eab308', linestyle='--', linewidth=1.5, label='Perfect prediction')
        ax.set_xlabel('Actual')
        ax.set_ylabel('Predicted')
        ax.set_title(f'Predicted vs Actual — {TARGET_LABELS[col]}')
        ax.legend()
        fig.tight_layout()
        out_path = REPORT_DIR / f'predicted_vs_actual_{col.replace("_target_30min", "")}.png'
        fig.savefig(out_path, dpi=150)
        plt.close(fig)
        print(f'Saved {out_path}')


def plot_feature_importance(model):
    importances = model.feature_importances_
    order = np.argsort(importances)[::-1]
    sorted_features = [FEATURE_COLUMNS[i] for i in order]
    sorted_importances = importances[order]

    fig, ax = plt.subplots(figsize=(8, 8))
    ax.barh(sorted_features[::-1], sorted_importances[::-1], color='#6366f1')
    ax.set_xlabel('Importance (aggregate across all 4 outputs)')
    ax.set_title('Random Forest Feature Importance')
    fig.tight_layout()
    out_path = REPORT_DIR / 'feature_importance.png'
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f'Saved {out_path}')

    return pd.DataFrame({'feature': sorted_features, 'importance': sorted_importances})


def main():
    train_df, val_df, test_df = load_splits()
    print(f'train rows={len(train_df)}  val rows={len(val_df)}  test rows={len(test_df)}\n')

    X_train, y_train = to_xy(train_df)
    X_val, y_val = to_xy(val_df)
    X_test, y_test = to_xy(test_df)

    best_config = select_model(X_train, y_train, X_val, y_val)

    # Hyperparameters were chosen using val only; val now joins train for the
    # final fit so the deployed model uses all non-test data. Test stays
    # untouched until the single evaluation below.
    train_val_df = pd.concat([train_df, val_df])
    X_train_val, y_train_val = to_xy(train_val_df)
    final_model = RandomForestRegressor(random_state=RANDOM_STATE, n_jobs=-1, **best_config)
    final_model.fit(X_train_val, y_train_val)

    metrics_df, preds = evaluate(final_model, X_test, y_test)
    print('Test-set metrics (final model, test set touched for the first time here):')
    print(metrics_df.to_string(index=False))

    plot_predicted_vs_actual(y_test, preds)
    importance_df = plot_feature_importance(final_model)
    print('\nTop 10 features by importance:')
    print(importance_df.head(10).to_string(index=False))

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model_path = MODEL_DIR / 'paracetamol_random_forest.joblib'
    joblib.dump(final_model, model_path)

    manifest = {
        'model_type': 'RandomForestRegressor (native multi-output)',
        'hyperparameters': best_config,
        'random_state': RANDOM_STATE,
        'feature_columns': FEATURE_COLUMNS,
        'target_columns': TARGET_COLUMNS,
        'trained_on': 'train + val splits combined',
        'evaluated_on': 'test split only',
        'row_counts': {
            'train': len(train_df), 'val': len(val_df), 'test': len(test_df),
            'train_plus_val': len(train_val_df),
        },
        'test_metrics': metrics_df.to_dict(orient='records'),
        'top_10_features': importance_df.head(10).to_dict(orient='records'),
        'sklearn_version': sklearn.__version__,
        'generated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
    manifest_path = MODEL_DIR / 'paracetamol_random_forest_manifest.json'
    manifest_path.write_text(json.dumps(manifest, indent=2))

    metrics_path = REPORT_DIR / 'test_metrics.csv'
    metrics_df.to_csv(metrics_path, index=False)

    print(f'\nSaved model to {model_path}')
    print(f'Saved manifest to {manifest_path}')
    print(f'Saved metrics to {metrics_path}')


if __name__ == '__main__':
    main()
