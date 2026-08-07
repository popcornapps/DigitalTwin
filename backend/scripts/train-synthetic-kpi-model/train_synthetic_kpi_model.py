"""Trains the KPI Prediction & Deviation Agent's RandomForest regressor on
data/synthetic_kpi_training_dataset.csv (see
scripts/generate-synthetic-kpi-data/generate_synthetic_kpi_data.py for how
that data - and the learnable relationship it encodes - was constructed).

Entirely independent of the real parameter-prediction model/training
pipeline: reads only the new synthetic CSV/manifest, writes only new
models/synthetic_kpi_* files.
"""
import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import r2_score

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / 'data'
MODEL_DIR = REPO_ROOT / 'models'

TRAINING_CSV = DATA_DIR / 'synthetic_kpi_training_dataset.csv'
SYNTHETIC_MANIFEST = DATA_DIR / 'synthetic_kpi_manifest.json'
OUT_MODEL = MODEL_DIR / 'synthetic_kpi_random_forest.joblib'
OUT_MANIFEST = MODEL_DIR / 'synthetic_kpi_random_forest_manifest.json'


def train():
    manifest = json.loads(SYNTHETIC_MANIFEST.read_text())
    feature_columns = manifest['feature_columns']
    target_columns = manifest['target_columns']
    weight_column = manifest['weight_column']

    df = pd.read_csv(TRAINING_CSV)
    train_df = df[df['split'] == 'train']
    test_df = df[df['split'] == 'test']

    X_train = train_df[feature_columns].values
    y_train = train_df[target_columns].values
    w_train = train_df[weight_column].values
    X_test = test_df[feature_columns].values
    y_test = test_df[target_columns].values
    w_test = test_df[weight_column].values

    # max_depth/min_samples_leaf are capped deliberately: the synthetic labels
    # are smooth, low-noise functions of the features (by design - see the
    # generator's module docstring), so unbounded trees over-fit down to
    # near-individual-row splits and balloon to several GB on disk for no
    # accuracy benefit. Capping keeps the model a reasonable size while test
    # R^2 stays effectively the same.
    model = RandomForestRegressor(
        n_estimators=100, max_depth=18, min_samples_leaf=10, random_state=42, n_jobs=-1,
    )
    # sample_weight down-weights rows sampled before a batch's drifting
    # parameter(s) could have started (see the generator's WEIGHT_COLUMN
    # docstring) - those rows are genuinely unpredictable from their input
    # alone, and training on them at full weight only spends model capacity
    # trying to fit noise it can't win against.
    model.fit(X_train, y_train, sample_weight=w_train)

    y_pred = model.predict(X_test)
    # Two views of test accuracy: unweighted (every row counts equally - the
    # honest, unadjusted picture) and weighted (matching the same weighting
    # used for training - reflects how well the model does on the part of
    # each batch that's actually learnable, without the unavoidable
    # pre-onset ambiguity dragging the number down).
    metrics_unweighted = {col: round(float(r2_score(y_test[:, i], y_pred[:, i])), 4) for i, col in enumerate(target_columns)}
    metrics_weighted = {
        col: round(float(r2_score(y_test[:, i], y_pred[:, i], sample_weight=w_test)), 4) for i, col in enumerate(target_columns)
    }

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, OUT_MODEL)

    out_manifest = {
        'model_type': 'RandomForestRegressor (native multi-output)',
        'n_estimators': 100,
        'max_depth': 18,
        'min_samples_leaf': 10,
        'random_state': 42,
        'plant': manifest['plant'],
        'product': manifest['product'],
        'feature_columns': feature_columns,
        'target_columns': target_columns,
        'test_r2_unweighted': metrics_unweighted,
        'test_r2_weighted': metrics_weighted,
        'n_train_rows': len(train_df),
        'n_test_rows': len(test_df),
        'trained_on': str(TRAINING_CSV.relative_to(REPO_ROOT)),
        'generation_method_version': manifest['generation_method_version'],
    }
    with OUT_MANIFEST.open('w') as f:
        json.dump(out_manifest, f, indent=2)

    print('Test R^2 by target (unweighted / weighted):')
    for col in target_columns:
        print(f'  {col}: {metrics_unweighted[col]} / {metrics_weighted[col]}')
    print(f'Wrote model -> {OUT_MODEL}')
    print(f'Wrote manifest -> {OUT_MANIFEST}')


if __name__ == '__main__':
    train()
