"""Verifies each Postgres table matches its source CSV exactly - row counts
plus a full, column-by-column value comparison (float columns compared with
a tight tolerance to absorb harmless text round-trip formatting, everything
else compared exactly, including the literal "None" text - this runs BEFORE
cleanup_none_values.sql, so a real NULL here would itself be a mismatch).

Run from the repo root with the project's existing venv:
    .venv/bin/python backend/scripts/postgres-migration/verify_import.py
"""
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg2
from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = BACKEND_ROOT / 'data'

load_dotenv(BACKEND_ROOT / '.env')

DATABASE_URL = os.environ.get('DATABASE_URL')

# (table, csv filename, primary key columns to sort by for row alignment)
TABLES = [
    ('batches', 'paracetamol_batches.csv', ['batch_id']),
    ('batch_timeseries', 'paracetamol_batch_timeseries.csv', ['batch_id', 'elapsed_minutes']),
    ('training_dataset', 'paracetamol_training_dataset.csv', ['batch_id', 'elapsed_minutes']),
    ('batch_kpis', 'paracetamol_batch_kpis.csv', ['batch_id']),
    ('parameters', 'paracetamol_parameter_config.csv', ['parameter']),
    ('golden_envelope', 'paracetamol_golden_envelope.csv', ['elapsed_minutes']),
    ('synthetic_kpi_training_dataset', 'synthetic_kpi_training_dataset.csv', ['batch_id', 'elapsed_minutes']),
]

# Compared as actual instants (below), not as raw text - the CSV's
# "...T19:00:00.000Z" and Postgres's "...19:00:00+00:00" are two valid
# textual spellings of the identical UTC moment, not a real mismatch.
DATETIME_COLS = {'batch_start_datetime'}


def _normalize(df: pd.DataFrame, sort_cols: list[str]) -> pd.DataFrame:
    return df.sort_values(sort_cols).reset_index(drop=True)


def _compare(table: str, csv_df: pd.DataFrame, db_df: pd.DataFrame) -> list[str]:
    problems = []
    if len(csv_df) != len(db_df):
        problems.append(f'row count mismatch: CSV={len(csv_df)} DB={len(db_df)}')
        return problems  # further comparison is meaningless if counts differ

    if list(csv_df.columns) != list(db_df.columns):
        problems.append(f'column mismatch: CSV={list(csv_df.columns)} DB={list(db_df.columns)}')
        return problems

    for col in csv_df.columns:
        csv_col, db_col = csv_df[col], db_df[col]
        if col in DATETIME_COLS:
            csv_ts = pd.to_datetime(csv_col, utc=True)
            db_ts = pd.to_datetime(db_col, utc=True)
            mismatch = csv_ts.ne(db_ts)
        elif pd.api.types.is_float_dtype(csv_col) or pd.api.types.is_float_dtype(db_col):
            csv_vals = pd.to_numeric(csv_col, errors='coerce')
            db_vals = pd.to_numeric(db_col, errors='coerce')
            both_nan = csv_vals.isna() & db_vals.isna()
            close = np.isclose(csv_vals.fillna(0), db_vals.fillna(0), rtol=1e-9, atol=1e-9)
            mismatch = ~(close | both_nan)
        else:
            csv_str = csv_col.astype(str).where(csv_col.notna(), None)
            db_str = db_col.astype(str).where(db_col.notna(), None)
            mismatch = csv_str.ne(db_str) & ~(csv_col.isna() & db_col.isna())

        n_bad = int(mismatch.sum())
        if n_bad:
            sample_idx = mismatch[mismatch].index[:3]
            samples = [
                f'row {i}: csv={csv_col.iloc[i]!r} db={db_col.iloc[i]!r}'
                for i in sample_idx
            ]
            problems.append(f'column "{col}": {n_bad} mismatched value(s), e.g. ' + '; '.join(samples))

    return problems


def main() -> None:
    if not DATABASE_URL:
        sys.exit('DATABASE_URL not set - add it to backend/.env first.')

    conn = psycopg2.connect(DATABASE_URL)
    overall_ok = True
    try:
        for table, csv_name, sort_cols in TABLES:
            # keep_default_na=False: pandas' default NA-token list includes
            # the literal word "None", which would otherwise silently turn
            # the CSV's real "no deviation" text into NaN before we ever get
            # to compare it - defeating the whole point of this pre-cleanup,
            # faithful-mirror verification pass.
            csv_df = pd.read_csv(DATA_DIR / csv_name, keep_default_na=False, na_values=[''])
            db_df = pd.read_sql(f'SELECT * FROM {table}', conn)

            csv_df = _normalize(csv_df, sort_cols)
            db_df = _normalize(db_df, sort_cols)

            problems = _compare(table, csv_df, db_df)
            if problems:
                overall_ok = False
                print(f'{table}: MISMATCH')
                for p in problems:
                    print(f'  - {p}')
            else:
                print(f'{table}: MATCH ({len(csv_df):,} rows, {len(csv_df.columns)} columns)')
    finally:
        conn.close()

    if not overall_ok:
        sys.exit('\nVerification FAILED - see mismatches above.')
    print('\nAll 7 tables match their source CSVs exactly.')


if __name__ == '__main__':
    main()
