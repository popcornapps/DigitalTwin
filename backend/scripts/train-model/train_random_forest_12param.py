"""Retrains the process-parameter prediction model using all 12 process
parameters (the original 4 + the 8 added in
scripts/generate-support-parameters/generate_support_parameters.py) instead
of just 4.

Reads batches/batch_timeseries/batch_support_timeseries straight from
Postgres - no CSV in, no CSV out - except a one-time READ of the existing
data/paracetamol_training_dataset.csv purely to reuse its train/val/test
batch-split assignment, so results stay comparable to the current 4-param
model. Nothing is written to that CSV.

Saves to NEW files (paracetamol_random_forest_12param.joblib + manifest) -
does NOT touch or overwrite models/paracetamol_random_forest.joblib/manifest,
the ones app/config.py's MODEL_PATH/MANIFEST_PATH actually point at. The
live simulator (app/live/simulator.py) only generates the original 4
parameters in real time today, so wiring this new model into the running
app is a separate future step, not this one.

Feature/window/target conventions are ported from
scripts/build-training-dataset/buildFeatures.ts + rollingStats.ts (same
30-minute lookback window, population mean/std, OLS slope-vs-position,
30-minute-ahead target - see also app/live/ml_bridge.py's _window_stats,
the live Python port of the same formulas) - identical math to today's
4-param model, just looped over 12 parameter keys instead of 4.
"""
import json
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT))

from app.db import get_connection  # noqa: E402

MODEL_DIR = BACKEND_ROOT / 'models'
SPLIT_SOURCE_CSV = BACKEND_ROOT / 'data' / 'paracetamol_training_dataset.csv'

LOOKBACK_MINUTES = 30
HORIZON_MINUTES = 30

# Maps this script's parameter keys to their source table+column - the
# original 4 live in batch_timeseries, the 8 added in Step 1 live in
# batch_support_timeseries.
PARAMETER_COLUMNS = {
    'temperature': ('batch_timeseries', 'temperature'),
    'process_pressure': ('batch_timeseries', 'process_pressure'),
    'flow_rate': ('batch_timeseries', 'flow_rate'),
    'agitator_rpm': ('batch_timeseries', 'agitator_rpm'),
    'inlet_air_humidity': ('batch_support_timeseries', 'inlet_air_humidity_pct'),
    'exhaust_air_temp': ('batch_support_timeseries', 'exhaust_air_temp_c'),
    'filter_differential_pressure': ('batch_support_timeseries', 'filter_differential_pressure_mbar'),
    'shaker_vibration_frequency': ('batch_support_timeseries', 'shaker_vibration_frequency_hz'),
    'product_bed_temp': ('batch_support_timeseries', 'product_bed_temp_c'),
    'chamber_differential_pressure': ('batch_support_timeseries', 'chamber_differential_pressure_mbar'),
    'ahu_damper_position': ('batch_support_timeseries', 'ahu_damper_position_pct'),
    'compressed_air_pressure': ('batch_support_timeseries', 'compressed_air_pressure_bar'),
}
PARAMETER_KEYS = list(PARAMETER_COLUMNS.keys())

FEATURE_COLUMNS = ['elapsed_minutes'] + [
    f'{key}_{stat}'
    for key in PARAMETER_KEYS
    for stat in ('current', 'mean_30', 'std_30', 'min_30', 'max_30', 'slope_30')
]
TARGET_COLUMNS = [f'{key}_target_30min' for key in PARAMETER_KEYS]

CANDIDATE_CONFIGS = [
    {'n_estimators': 100, 'max_depth': None},
    {'n_estimators': 200, 'max_depth': None},
    {'n_estimators': 200, 'max_depth': 12},
    {'n_estimators': 400, 'max_depth': 20},
]
RANDOM_STATE = 42

# --- OLS slope-vs-position formula, same as app/live/ml_bridge.py's
# _window_stats. Window positions (0..30) never change, so the denominator
# and xbar are fixed constants computed once. ---
_WINDOW = LOOKBACK_MINUTES + 1
_POSITIONS = np.arange(_WINDOW)
_XBAR = _POSITIONS.mean()
_DEN = float(((_POSITIONS - _XBAR) ** 2).sum())


def _rolling_slope(values: np.ndarray) -> float:
    mean = values.mean()
    return float(((_POSITIONS - _XBAR) * (values - mean)).sum() / _DEN)


def load_batch_split() -> dict:
    """Read-only: reuses the current model's batch_id -> split (train/val/
    test) assignment so this dataset's metrics stay comparable. Writes
    nothing."""
    df = pd.read_csv(SPLIT_SOURCE_CSV, usecols=['batch_id', 'split'])
    return dict(df.drop_duplicates('batch_id')[['batch_id', 'split']].values)


def load_raw_from_postgres() -> pd.DataFrame:
    """One row per (batch_id, elapsed_minutes) with all 12 raw parameter
    values - joins batch_timeseries (original 4) with
    batch_support_timeseries (the 8 from Step 1) on their shared key."""
    ts_cols = [(key, col) for key, (table, col) in PARAMETER_COLUMNS.items() if table == 'batch_timeseries']
    sup_cols = [(key, col) for key, (table, col) in PARAMETER_COLUMNS.items() if table == 'batch_support_timeseries']
    select_list = ', '.join(
        ['t.batch_id', 't.elapsed_minutes', 'b.deviation_scenario', 'b.deviation_severity']
        + [f't.{col}' for _, col in ts_cols]
        + [f's.{col}' for _, col in sup_cols]
    )
    query = f"""
        SELECT {select_list}
        FROM batch_timeseries t
        JOIN batch_support_timeseries s ON s.batch_id = t.batch_id AND s.elapsed_minutes = t.elapsed_minutes
        JOIN batches b ON b.batch_id = t.batch_id
        ORDER BY t.batch_id, t.elapsed_minutes
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(query)
            rows = cur.fetchall()
            columns = [d.name for d in cur.description]
    finally:
        conn.close()
    df = pd.DataFrame(rows, columns=columns)
    rename = {col: key for key, col in ts_cols + sup_cols}
    return df.rename(columns=rename)


def build_feature_rows(raw: pd.DataFrame, batch_split: dict) -> pd.DataFrame:
    """Same windowing/target logic as buildFeatures.ts (30-min lookback
    window, 30-min-ahead target), vectorized per batch via pandas .rolling(),
    looped over all 12 parameter keys instead of 4."""
    all_rows = []
    for batch_id, group in raw.groupby('batch_id', sort=False):
        split = batch_split.get(batch_id)
        if split is None:
            continue  # not one of the original 120 batches (e.g. a live-completed one) - skip

        group = group.sort_values('elapsed_minutes').reset_index(drop=True)
        out = pd.DataFrame({'elapsed_minutes': group['elapsed_minutes']})
        deviation_scenario = group['deviation_scenario'].iloc[0]
        deviation_severity = group['deviation_severity'].iloc[0]
        for key in PARAMETER_KEYS:
            col = group[key]
            out[f'{key}_current'] = col
            out[f'{key}_mean_30'] = col.rolling(_WINDOW, min_periods=_WINDOW).mean()
            out[f'{key}_std_30'] = col.rolling(_WINDOW, min_periods=_WINDOW).std(ddof=0)
            out[f'{key}_min_30'] = col.rolling(_WINDOW, min_periods=_WINDOW).min()
            out[f'{key}_max_30'] = col.rolling(_WINDOW, min_periods=_WINDOW).max()
            out[f'{key}_slope_30'] = col.rolling(_WINDOW, min_periods=_WINDOW).apply(_rolling_slope, raw=True)
            out[f'{key}_target_30min'] = col.shift(-HORIZON_MINUTES)

        out['batch_id'] = batch_id
        out['split'] = split
        out['deviation_scenario'] = deviation_scenario
        out['deviation_severity'] = deviation_severity
        out = out.dropna(subset=FEATURE_COLUMNS + TARGET_COLUMNS)
        all_rows.append(out)

    result = pd.concat(all_rows, ignore_index=True)
    numeric_cols = FEATURE_COLUMNS + TARGET_COLUMNS
    result[numeric_cols] = result[numeric_cols].round(4)
    return result


def write_training_dataset_to_postgres(dataset: pd.DataFrame) -> None:
    """Persists the computed 12-param feature/target rows into
    training_dataset_12param (see schema_training_dataset_12param.sql) - same
    role as the existing training_dataset table plays for the 4-param model,
    so this dataset is inspectable via psql instead of only existing
    in-memory during a training run."""
    columns = ['batch_id', 'deviation_scenario', 'deviation_severity', 'split', 'elapsed_minutes'] + FEATURE_COLUMNS[1:] + TARGET_COLUMNS
    # FEATURE_COLUMNS[1:] drops the leading 'elapsed_minutes' - already listed once above.
    # Series.tolist() (not DataFrame.values) so numpy int64/float64 scalars
    # convert to native Python int/float - psycopg2 can't adapt numpy scalars.
    columns_data = [dataset[col].tolist() for col in columns]
    rows = list(zip(*columns_data))
    placeholders = ', '.join(['%s'] * len(columns))
    column_list = ', '.join(columns)

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('TRUNCATE TABLE training_dataset_12param')
            cur.executemany(
                f'INSERT INTO training_dataset_12param ({column_list}) VALUES ({placeholders})',
                rows,
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    print(f'Wrote {len(rows)} rows to training_dataset_12param.')


def to_xy(df: pd.DataFrame):
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
        print(f'  {config} -> mean val R2={mean_r2:.4f}')
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


def main():
    batch_split = load_batch_split()
    raw = load_raw_from_postgres()
    dataset = build_feature_rows(raw, batch_split)
    write_training_dataset_to_postgres(dataset)

    train_df = dataset[dataset['split'] == 'train']
    val_df = dataset[dataset['split'] == 'val']
    test_df = dataset[dataset['split'] == 'test']
    print(f'train rows={len(train_df)}  val rows={len(val_df)}  test rows={len(test_df)}\n')

    X_train, y_train = to_xy(train_df)
    X_val, y_val = to_xy(val_df)
    X_test, y_test = to_xy(test_df)

    best_config = select_model(X_train, y_train, X_val, y_val)

    train_val_df = pd.concat([train_df, val_df])
    X_train_val, y_train_val = to_xy(train_val_df)
    final_model = RandomForestRegressor(random_state=RANDOM_STATE, n_jobs=-1, **best_config)
    final_model.fit(X_train_val, y_train_val)

    metrics_df, _ = evaluate(final_model, X_test, y_test)
    print('Test-set metrics (final model, test set touched for the first time here):')
    print(metrics_df.to_string(index=False))

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model_path = MODEL_DIR / 'paracetamol_random_forest_12param.joblib'
    joblib.dump(final_model, model_path)

    manifest = {
        'model_type': 'RandomForestRegressor (native multi-output, 12 parameters)',
        'hyperparameters': best_config,
        'random_state': RANDOM_STATE,
        'feature_columns': FEATURE_COLUMNS,
        'target_columns': TARGET_COLUMNS,
        'parameter_keys': PARAMETER_KEYS,
        'trained_on': 'train + val splits combined (same per-batch split as the 4-param model)',
        'evaluated_on': 'test split only',
        'row_counts': {
            'train': len(train_df), 'val': len(val_df), 'test': len(test_df),
            'train_plus_val': len(train_val_df),
        },
        'test_metrics': metrics_df.to_dict(orient='records'),
        'sklearn_version': sklearn.__version__,
        'generated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'note': (
            'Not wired into the running app yet - the live simulator only generates '
            'the original 4 parameters in real time. See '
            'models/paracetamol_random_forest_manifest.json for the model '
            'app/config.py actually points at.'
        ),
    }
    manifest_path = MODEL_DIR / 'paracetamol_random_forest_12param_manifest.json'
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f'\nSaved {model_path}')
    print(f'Saved {manifest_path}')


if __name__ == '__main__':
    main()
