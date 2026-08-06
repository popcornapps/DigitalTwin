"""Extends the golden_envelope Postgres table with a per-minute deviation
envelope for the 8 new process parameters (added in
scripts/generate-support-parameters/generate_support_parameters.py), so
Process Monitoring's deviation-status logic (app/live/deviation_agent.py)
works for all 12 parameters, not just the original 4.

Same method as scripts/generate-golden-envelope/generate_golden_envelope.py
(see that file's docstring for the full rationale) - reproduced here rather
than imported, since that script reads CSVs and this one reads Postgres
(batches, batch_support_timeseries) and WRITES to Postgres (ALTER TABLE +
UPDATE on the existing golden_envelope table, not a new one - same per-minute
grain as the 4-param columns already there):

1. For every Normal batch (excluding PAR-GOLDEN itself), compute its
   deviation from golden at every elapsed_minutes they share.
2. Per minute, take the 2.5th/97.5th percentile of that deviation across all
   Normal batches.
3. Smooth with a +-5-minute centered rolling median.
4. Freeze the offsets flat past the point sample size drops below 94% of the
   full population.
5. Floor each offset at 10% of the parameter's fixed band width (from the
   Postgres `parameters` table), so near-zero real variance doesn't produce
   a hypersensitive band.
"""
import sys
from pathlib import Path

import pandas as pd

BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT))

from app.db import get_connection  # noqa: E402

GOLDEN_BATCH_ID = 'PAR-GOLDEN'

PARAM_COLUMNS = {
    'inlet_air_humidity': 'inlet_air_humidity_pct',
    'exhaust_air_temp': 'exhaust_air_temp_c',
    'filter_differential_pressure': 'filter_differential_pressure_mbar',
    'shaker_vibration_frequency': 'shaker_vibration_frequency_hz',
    'product_bed_temp': 'product_bed_temp_c',
    'chamber_differential_pressure': 'chamber_differential_pressure_mbar',
    'ahu_damper_position': 'ahu_damper_position_pct',
    'compressed_air_pressure': 'compressed_air_pressure_bar',
}
PARAM_CONFIG_NAMES = {
    'inlet_air_humidity': 'Inlet Air Humidity',
    'exhaust_air_temp': 'Exhaust Air Temperature',
    'filter_differential_pressure': 'Filter Differential Pressure',
    'shaker_vibration_frequency': 'Shaker Vibration Frequency',
    'product_bed_temp': 'Product Bed Temperature',
    'chamber_differential_pressure': 'Chamber Differential Pressure',
    'ahu_damper_position': 'AHU Damper Position',
    'compressed_air_pressure': 'Compressed Air Pressure',
}

SMOOTH_WINDOW_MINUTES = 11  # +-5 minutes, centered
RELIABLE_SAMPLE_FRACTION = 0.94
FLOOR_FRACTION_OF_BAND = 0.10


def load_data():
    conn = get_connection()
    try:
        batches = pd.read_sql("SELECT batch_id, deviation_severity FROM batches", conn)
        support_ts = pd.read_sql(
            f"SELECT batch_id, elapsed_minutes, {', '.join(PARAM_COLUMNS.values())} FROM batch_support_timeseries",
            conn,
        )
        with conn.cursor() as cur:
            cur.execute(
                'SELECT parameter, lower_limit, upper_limit FROM parameters WHERE parameter = ANY(%s)',
                (list(PARAM_CONFIG_NAMES.values()),),
            )
            limits_by_name = {name: (lower, upper) for name, lower, upper in cur.fetchall()}
    finally:
        conn.close()
    support_ts = support_ts.rename(columns={col: key for key, col in PARAM_COLUMNS.items()})
    return batches, support_ts, limits_by_name


def main():
    batches, support_ts, limits_by_name = load_data()

    golden = support_ts[support_ts['batch_id'] == GOLDEN_BATCH_ID].set_index('elapsed_minutes')
    golden_max_t = int(golden.index.max())

    normal_ids = batches.loc[batches['deviation_severity'].isin([None, 'None']), 'batch_id']
    normal_ids = normal_ids[normal_ids != GOLDEN_BATCH_ID].tolist()
    total_normal = len(normal_ids)
    print(f'Golden duration: {golden_max_t} min | Normal batches (excl. golden): {total_normal}')

    ts_by_batch = {bid: g.set_index('elapsed_minutes') for bid, g in support_ts.groupby('batch_id')}

    rows = []
    for bid in normal_ids:
        b = ts_by_batch.get(bid)
        if b is None:
            continue
        common_t = b.index.intersection(golden.index)
        for param in PARAM_COLUMNS:
            dev = (b.loc[common_t, param] - golden.loc[common_t, param]).values
            for t, d in zip(common_t, dev):
                rows.append((t, param, d))
    dev_df = pd.DataFrame(rows, columns=['elapsed_minutes', 'param', 'deviation'])

    result = pd.DataFrame({'elapsed_minutes': range(0, golden_max_t + 1)}).set_index('elapsed_minutes')

    for param in PARAM_COLUMNS:
        lower_limit, upper_limit = limits_by_name[PARAM_CONFIG_NAMES[param]]
        band_width = upper_limit - lower_limit
        floor = band_width * FLOOR_FRACTION_OF_BAND

        pdf = dev_df[dev_df['param'] == param]
        grouped = pdf.groupby('elapsed_minutes')['deviation']
        per_minute = pd.DataFrame({
            'count': grouped.count(),
            'p2_5': grouped.quantile(0.025),
            'p97_5': grouped.quantile(0.975),
        }).reindex(range(0, golden_max_t + 1))

        smoothed_lower = per_minute['p2_5'].rolling(SMOOTH_WINDOW_MINUTES, center=True, min_periods=1).median()
        smoothed_upper = per_minute['p97_5'].rolling(SMOOTH_WINDOW_MINUTES, center=True, min_periods=1).median()

        half_window = SMOOTH_WINDOW_MINUTES // 2
        reliable = per_minute['count'] >= total_normal * RELIABLE_SAMPLE_FRACTION
        last_reliable_raw_t = reliable[reliable].index.max()
        freeze_t = last_reliable_raw_t - half_window if pd.notna(last_reliable_raw_t) else None
        if freeze_t is not None:
            smoothed_lower.loc[smoothed_lower.index > freeze_t] = smoothed_lower.loc[freeze_t]
            smoothed_upper.loc[smoothed_upper.index > freeze_t] = smoothed_upper.loc[freeze_t]

        lower_offset = smoothed_lower.clip(upper=-floor)
        upper_offset = smoothed_upper.clip(lower=floor)

        result[f'{param}_lower_offset'] = lower_offset.round(3)
        result[f'{param}_upper_offset'] = upper_offset.round(3)

        print(f'{param}: frozen from minute {freeze_t} onward, floor = {floor:.3f}')

    result = result.reset_index()

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            for param in PARAM_COLUMNS:
                cur.execute(
                    f'ALTER TABLE golden_envelope ADD COLUMN IF NOT EXISTS {param}_lower_offset double precision'
                )
                cur.execute(
                    f'ALTER TABLE golden_envelope ADD COLUMN IF NOT EXISTS {param}_upper_offset double precision'
                )
            set_clause = ', '.join(
                f'{param}_lower_offset = %s, {param}_upper_offset = %s' for param in PARAM_COLUMNS
            )
            for _, row in result.iterrows():
                values = []
                for param in PARAM_COLUMNS:
                    values.append(float(row[f'{param}_lower_offset']))
                    values.append(float(row[f'{param}_upper_offset']))
                values.append(int(row['elapsed_minutes']))
                cur.execute(
                    f'UPDATE golden_envelope SET {set_clause} WHERE elapsed_minutes = %s',
                    values,
                )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    print(f'Updated {len(result)} rows in golden_envelope with 8 new parameter offset columns.')


if __name__ == '__main__':
    main()
