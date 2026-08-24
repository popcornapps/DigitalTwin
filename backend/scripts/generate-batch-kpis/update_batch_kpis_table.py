"""Pushes the v3 (8-parameter) recalculation from generate_batch_kpis.py into
Postgres - a targeted UPDATE only, deliberately NOT a TRUNCATE/reload like
scripts/postgres-migration/import_csvs.py. Only the columns this specific
formula fix actually changes are touched, only for the batch_ids present in
the regenerated CSVs (the original 120 historical batches + PAR-GOLDEN) -
every other row, column, and table (batch_timeseries, batch_support_timeseries,
golden_envelope, alerts, live-completed batches PAR-121 onward, ...) is
completely untouched.

Run generate_batch_kpis.py FIRST (it only reads Postgres and writes local
CSVs - safe, non-destructive) to produce the new numbers this script reads.

Defaults to a dry run that prints exactly what would change, row by row, and
a summary count - nothing is written to Postgres unless --apply is passed
explicitly. Intended to be run manually; not invoked by any other code.
"""
import argparse
import sys
from pathlib import Path

import pandas as pd

BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT))

from app import config  # noqa: E402
from app.db import get_connection  # noqa: E402

# Only these columns are updated - exactly the ones generate_batch_kpis.py's
# v3 formula change actually affects. process_stability_pct, similarity,
# fault_onset, cycle_time, oee_availability_pct, oee_performance_pct,
# generation_method_version's tag family etc. are all untouched by this fix
# and deliberately excluded here, so a partial/unexpected diff elsewhere
# can never be masked by this script overwriting it.
BATCH_KPIS_UPDATE_COLUMNS = [
    'actual_output_kg', 'assay_pct', 'yield_pct', 'quality_score_pct',
    'oee_quality_pct', 'oee_pct', 'total_energy_kwh', 'sec_kwh_per_kg',
    'generation_method_version',
]
BATCHES_UPDATE_COLUMNS = ['actual_output_kg', 'energy_kwh', 'assay_pct']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Actually write to Postgres. Omit for a dry run.')
    args = parser.parse_args()

    new_kpis = pd.read_csv(config.BATCH_KPIS_CSV).set_index('batch_id')
    new_batches = pd.read_csv(config.BATCHES_CSV).set_index('batch_id')
    batch_ids = list(new_kpis.index)

    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT batch_id, {', '.join(BATCH_KPIS_UPDATE_COLUMNS)} FROM batch_kpis "
            f"WHERE batch_id = ANY(%s)",
            (batch_ids,),
        )
        old_kpis = {row[0]: dict(zip(BATCH_KPIS_UPDATE_COLUMNS, row[1:])) for row in cur.fetchall()}

    missing = [bid for bid in batch_ids if bid not in old_kpis]
    if missing:
        raise RuntimeError(
            f'{len(missing)} batch_id(s) from the regenerated CSV have no existing batch_kpis row in '
            f'Postgres - this script only UPDATEs existing rows, never inserts: {missing[:10]}'
        )

    print(f'{"APPLYING" if args.apply else "DRY RUN"} - {len(batch_ids)} batch_kpis rows in scope\n')

    changed = 0
    for batch_id in batch_ids:
        # float(...) - pandas .loc returns numpy scalar types (e.g. np.float64),
        # which psycopg2 in this environment stringifies as "np.float64(...)"
        # literal text instead of binding as a parameter. Plain Python floats
        # bind correctly.
        new_row = {col: (float(new_kpis.loc[batch_id, col]) if col != 'generation_method_version' else 'v3')
                   for col in BATCH_KPIS_UPDATE_COLUMNS}
        old_row = old_kpis[batch_id]
        diffs = {
            col: (old_row[col], new_row[col]) for col in BATCH_KPIS_UPDATE_COLUMNS
            if col != 'generation_method_version' and old_row[col] != new_row[col]
        }
        if diffs:
            changed += 1
            print(f'{batch_id}: ' + ', '.join(f'{c} {o}->{n}' for c, (o, n) in diffs.items()))

        if args.apply:
            with get_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE batch_kpis SET
                        actual_output_kg = %(actual_output_kg)s, assay_pct = %(assay_pct)s,
                        yield_pct = %(yield_pct)s, quality_score_pct = %(quality_score_pct)s,
                        oee_quality_pct = %(oee_quality_pct)s, oee_pct = %(oee_pct)s,
                        total_energy_kwh = %(total_energy_kwh)s, sec_kwh_per_kg = %(sec_kwh_per_kg)s,
                        generation_method_version = %(generation_method_version)s
                    WHERE batch_id = %(batch_id)s
                    """,
                    {**new_row, 'batch_id': batch_id},
                )
                cur.execute(
                    """
                    UPDATE batches SET
                        actual_output_kg = %(actual_output_kg)s, energy_kwh = %(energy_kwh)s,
                        assay_pct = %(assay_pct)s
                    WHERE batch_id = %(batch_id)s
                    """,
                    {
                        'batch_id': batch_id,
                        'actual_output_kg': float(new_batches.loc[batch_id, 'actual_output_kg']),
                        'energy_kwh': float(new_batches.loc[batch_id, 'energy_kwh']),
                        'assay_pct': float(new_batches.loc[batch_id, 'assay_pct']),
                    },
                )
                conn.commit()

    print(f'\n{changed} of {len(batch_ids)} batches have a real value change.')
    if not args.apply:
        print('Dry run only - no Postgres rows were modified. Re-run with --apply to write these changes.')


if __name__ == '__main__':
    main()
