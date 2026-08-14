"""Trains the KPI Prediction & Deviation Agent's RandomForest regressor on
synthetic_kpi_training_dataset_12param (Postgres table - see
scripts/generate-synthetic-kpi-data/generate_synthetic_kpi_data.py for how
that data - and the learnable relationship it encodes - was constructed, now
covering all 12 process parameters instead of 4).

Saves to NEW, separate files (synthetic_kpi_random_forest_12param.joblib +
manifest) - does not touch or overwrite models/synthetic_kpi_random_forest.
joblib/manifest, the ones the running app actually uses (see
app/live/kpi_prediction_agent.py's MODEL_PATH/MANIFEST_PATH). Wiring the new
model into the running app is a separate, deliberate cutover step.

Entirely independent of the real parameter-prediction model/training
pipeline: reads only its own Postgres table, writes only new
models/synthetic_kpi_*_12param files - no CSV in, no CSV out.
"""
import json
import sys
from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import r2_score

BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT))

from app.db import get_connection  # noqa: E402

MODEL_DIR = BACKEND_ROOT / 'models'
OUT_MODEL = MODEL_DIR / 'synthetic_kpi_random_forest_12param.joblib'
OUT_MANIFEST = MODEL_DIR / 'synthetic_kpi_random_forest_12param_manifest.json'

PARAMETER_KEYS = (
    'temperature', 'process_pressure', 'flow_rate', 'agitator_rpm',
    'inlet_air_humidity', 'exhaust_air_temp', 'filter_differential_pressure',
    'shaker_vibration_frequency', 'product_bed_temp', 'chamber_differential_pressure',
    'ahu_damper_position', 'compressed_air_pressure',
)
FEATURE_COLUMNS = ['elapsed_minutes'] + [
    f'{key}_{stat}' for key in PARAMETER_KEYS for stat in ('current', 'mean_30', 'std_30', 'min_30', 'max_30', 'slope_30')
]
TARGET_COLUMNS = ['yield_pct_final', 'quality_score_pct_final', 'sec_kwh_per_kg_final', 'oee_pct_final', 'total_energy_kwh_final']
WEIGHT_COLUMN = 'row_weight'
PLANT = 'Hyderabad Plant'
PRODUCT = 'Paracetamol 500mg'
GENERATION_METHOD_VERSION = 'v7-12param-causal8-noisefloor'

# Matches app/live/kpi_prediction_agent.py's NOMINAL_TOTAL_DURATION and
# EARLY_BATCH_FRACTION/MID_BATCH_FRACTION exactly (ported, not imported, same
# convention the rest of this pipeline already uses) - stratifying test R^2
# by these same buckets tells us whether the model is already accurate where
# the app's own confidence gate says to trust it (>= MID_BATCH_FRACTION),
# rather than relying on one blended number that early-batch rows - honestly
# hard to predict from a 30-minute window alone, and already flagged
# Low-confidence in the UI - would otherwise drag down.
NOMINAL_TOTAL_DURATION = 385
EARLY_BATCH_FRACTION = 0.25
MID_BATCH_FRACTION = 0.55


def load_dataset() -> pd.DataFrame:
    needed_columns = ['split'] + FEATURE_COLUMNS + TARGET_COLUMNS + [WEIGHT_COLUMN]
    conn = get_connection()
    try:
        return pd.read_sql(
            f"SELECT {', '.join(needed_columns)} FROM synthetic_kpi_training_dataset_12param", conn
        )
    finally:
        conn.close()


def train():
    df = load_dataset()
    train_df = df[df['split'] == 'train']
    test_df = df[df['split'] == 'test']

    X_train = train_df[FEATURE_COLUMNS].values
    y_train = train_df[TARGET_COLUMNS].values
    w_train = train_df[WEIGHT_COLUMN].values
    X_test = test_df[FEATURE_COLUMNS].values
    y_test = test_df[TARGET_COLUMNS].values
    w_test = test_df[WEIGHT_COLUMN].values

    # max_depth/min_samples_leaf are capped deliberately: the synthetic labels
    # are smooth, low-noise functions of the features (by design - see the
    # generator's module docstring), so unbounded trees over-fit down to
    # near-individual-row splits and balloon to several GB on disk for no
    # accuracy benefit. Capping keeps the model a reasonable size while test
    # R^2 stays effectively the same. Same hyperparameters as the 4-param
    # model - this step is about feature coverage, not re-tuning.
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
    metrics_unweighted = {col: round(float(r2_score(y_test[:, i], y_pred[:, i])), 4) for i, col in enumerate(TARGET_COLUMNS)}
    metrics_weighted = {
        col: round(float(r2_score(y_test[:, i], y_pred[:, i], sample_weight=w_test)), 4) for i, col in enumerate(TARGET_COLUMNS)
    }

    # Elapsed-fraction-stratified R^2 (unweighted) - the global numbers above
    # blend genuinely-hard-to-predict early-batch rows (a 30-min window taken
    # before a fault has ramped up looks almost like a Normal row, yet must
    # predict the same eventual outcome) with late-batch rows, whose window
    # mostly reflects the final ramp already and so should be far easier.
    # Bucketing by elapsed_minutes / NOMINAL_TOTAL_DURATION tells us whether
    # the model is already accurate where it matters most operationally -
    # >= MID_BATCH_FRACTION, the same point app/live/kpi_prediction_agent.py's
    # _evidence_ceiling starts allowing High confidence - rather than relying
    # on one blended number that early rows (already flagged Low-confidence
    # in the UI, regardless of what the model predicts) would otherwise drag
    # down.
    elapsed_fraction = test_df['elapsed_minutes'].values / NOMINAL_TOTAL_DURATION
    buckets = {
        'early (<25% elapsed)': elapsed_fraction < EARLY_BATCH_FRACTION,
        'mid (25-55% elapsed)': (elapsed_fraction >= EARLY_BATCH_FRACTION) & (elapsed_fraction < MID_BATCH_FRACTION),
        'late (>=55% elapsed)': elapsed_fraction >= MID_BATCH_FRACTION,
    }
    metrics_by_bucket = {}
    for bucket_name, mask in buckets.items():
        if mask.sum() == 0:
            continue
        metrics_by_bucket[bucket_name] = {
            'n_rows': int(mask.sum()),
            **{col: round(float(r2_score(y_test[mask, i], y_pred[mask, i])), 4) for i, col in enumerate(TARGET_COLUMNS)},
        }

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, OUT_MODEL)

    out_manifest = {
        'model_type': 'RandomForestRegressor (native multi-output, 12 parameters)',
        'n_estimators': 100,
        'max_depth': 18,
        'min_samples_leaf': 10,
        'random_state': 42,
        'plant': PLANT,
        'product': PRODUCT,
        'parameter_keys': list(PARAMETER_KEYS),
        'feature_columns': FEATURE_COLUMNS,
        'target_columns': TARGET_COLUMNS,
        'test_r2_unweighted': metrics_unweighted,
        'test_r2_weighted': metrics_weighted,
        'test_r2_by_elapsed_bucket': metrics_by_bucket,
        'n_train_rows': len(train_df),
        'n_test_rows': len(test_df),
        'trained_on': 'synthetic_kpi_training_dataset_12param (Postgres)',
        'generation_method_version': GENERATION_METHOD_VERSION,
        'note': (
            'Not wired into the running app yet - see app/live/kpi_prediction_agent.py '
            "for the model/manifest the app actually points at."
        ),
    }
    with OUT_MANIFEST.open('w') as f:
        json.dump(out_manifest, f, indent=2)

    print('Test R^2 by target (unweighted / weighted):')
    for col in TARGET_COLUMNS:
        print(f'  {col}: {metrics_unweighted[col]} / {metrics_weighted[col]}')
    print('Test R^2 by elapsed-time bucket (unweighted):')
    for bucket_name, bucket_metrics in metrics_by_bucket.items():
        print(f"  {bucket_name} (n={bucket_metrics['n_rows']}):")
        for col in TARGET_COLUMNS:
            print(f'    {col}: {bucket_metrics[col]}')
    print(f'Wrote model -> {OUT_MODEL}')
    print(f'Wrote manifest -> {OUT_MANIFEST}')


if __name__ == '__main__':
    train()
