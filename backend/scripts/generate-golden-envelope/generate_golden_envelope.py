"""Generates data/paracetamol_golden_envelope.csv - a per-minute, data-derived
deviation envelope around the golden batch, replacing the fixed
parameter_config.csv band as the basis for deviation status in Process
Monitoring.

Why this exists: the fixed golden band (e.g. Temperature 63-67C) is only
physically meaningful during steady-state drying. Comparing every minute of
a batch against that same fixed band (now that phase-awareness has been
removed from the UI, per the running-batch design) makes early-batch minutes
look falsely "Critical", since the recipe hasn't pushed the parameter toward
that band yet. This script instead asks: "at this exact minute, how much do
real Normal batches actually vary from the golden batch?" - and uses THAT
empirical spread as the deviation threshold, which is meaningful at every
minute of the batch, not just one stage of it.

Method (see docs discussion this session for the full analysis):
1. For every Normal batch (excluding the golden batch itself), compute its
   deviation from golden at every elapsed_minutes they share.
2. Per minute, take the 2.5th/97.5th percentile of that deviation across all
   80 Normal batches - an asymmetric, distribution-shape-agnostic band
   (chosen over mean+-2sigma because Flow Rate and Temperature both showed
   a heavier upper tail than a normal-distribution assumption would predict).
3. Smooth with a +-5-minute centered rolling median, since 80 samples/minute
   is enough to be directional but noisy point-to-point.
4. Freeze the offsets flat past the point where sample size drops below 94%
   of the full 80 (batches run different total durations, so the deep tail
   is thin-sample and unreliable - trusting it directly would bake noise
   into the envelope).
5. Floor each offset at 10% of the original fixed band's width, so minutes
   where Normal batches show near-zero real variance (e.g. Agitator RPM
   sitting at exactly 0 for the entire drying phase) don't produce a
   zero-width band that would be hypersensitive to trivial simulator noise.
"""
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / 'data'

BATCHES_CSV = DATA_DIR / 'paracetamol_batches.csv'
TIMESERIES_CSV = DATA_DIR / 'paracetamol_batch_timeseries.csv'
PARAMETER_CONFIG_CSV = DATA_DIR / 'paracetamol_parameter_config.csv'
OUT_CSV = DATA_DIR / 'paracetamol_golden_envelope.csv'

PARAM_KEYS = ['temperature', 'process_pressure', 'flow_rate', 'agitator_rpm']
PARAM_CONFIG_NAMES = {
    'temperature': 'Temperature',
    'process_pressure': 'Process Pressure',
    'flow_rate': 'Flow Rate',
    'agitator_rpm': 'Agitator RPM',
}

SMOOTH_WINDOW_MINUTES = 11  # +-5 minutes, centered
RELIABLE_SAMPLE_FRACTION = 0.94  # freeze offsets once sample count drops below this fraction of the full population
FLOOR_FRACTION_OF_BAND = 0.10


def main():
    batches = pd.read_csv(BATCHES_CSV)
    ts = pd.read_csv(TIMESERIES_CSV)
    param_config = pd.read_csv(PARAMETER_CONFIG_CSV).set_index('parameter')

    golden = ts[ts['batch_id'] == 'PAR-GOLDEN'].set_index('elapsed_minutes')
    golden_max_t = int(golden.index.max())

    normal_ids = batches.loc[batches['deviation_severity'].isna(), 'batch_id']
    normal_ids = normal_ids[normal_ids != 'PAR-GOLDEN'].tolist()
    total_normal = len(normal_ids)
    print(f'Golden duration: {golden_max_t} min | Normal batches (excl. golden): {total_normal}')

    rows = []
    for bid in normal_ids:
        b = ts[ts['batch_id'] == bid].set_index('elapsed_minutes')
        common_t = b.index.intersection(golden.index)
        for param in PARAM_KEYS:
            dev = (b.loc[common_t, param] - golden.loc[common_t, param]).values
            for t, d in zip(common_t, dev):
                rows.append((t, param, d))
    dev_df = pd.DataFrame(rows, columns=['elapsed_minutes', 'param', 'deviation'])

    result = pd.DataFrame({'elapsed_minutes': range(0, golden_max_t + 1)}).set_index('elapsed_minutes')

    for param in PARAM_KEYS:
        band_width = param_config.loc[PARAM_CONFIG_NAMES[param], 'upper_limit'] - param_config.loc[PARAM_CONFIG_NAMES[param], 'lower_limit']
        floor = band_width * FLOOR_FRACTION_OF_BAND

        pdf = dev_df[dev_df['param'] == param]
        grouped = pdf.groupby('elapsed_minutes')['deviation']
        per_minute = pd.DataFrame({
            'count': grouped.count(),
            'p2_5': grouped.quantile(0.025),
            'p97_5': grouped.quantile(0.975),
        }).reindex(range(0, golden_max_t + 1))

        # Smooth to reduce point-to-point sampling noise.
        smoothed_lower = per_minute['p2_5'].rolling(SMOOTH_WINDOW_MINUTES, center=True, min_periods=1).median()
        smoothed_upper = per_minute['p97_5'].rolling(SMOOTH_WINDOW_MINUTES, center=True, min_periods=1).median()

        # Freeze past the point sample size becomes unreliable (batches of
        # different total durations thin out the deep tail). The freeze point
        # is pulled back by half the smoothing window so the frozen value's
        # OWN rolling window never reaches into the thinning tail either -
        # otherwise the "frozen" value would itself already be contaminated
        # by the noisy minutes just past the raw reliability boundary.
        half_window = SMOOTH_WINDOW_MINUTES // 2
        reliable = per_minute['count'] >= total_normal * RELIABLE_SAMPLE_FRACTION
        last_reliable_raw_t = reliable[reliable].index.max()
        freeze_t = last_reliable_raw_t - half_window if pd.notna(last_reliable_raw_t) else None
        if freeze_t is not None:
            smoothed_lower.loc[smoothed_lower.index > freeze_t] = smoothed_lower.loc[freeze_t]
            smoothed_upper.loc[smoothed_upper.index > freeze_t] = smoothed_upper.loc[freeze_t]

        # Floor so a near-zero empirical spread doesn't produce a hypersensitive band.
        lower_offset = smoothed_lower.clip(upper=-floor)
        upper_offset = smoothed_upper.clip(lower=floor)

        result[f'{param}_lower_offset'] = lower_offset.round(3)
        result[f'{param}_upper_offset'] = upper_offset.round(3)

        print(f'{param}: frozen from minute {freeze_t} onward, floor = {floor:.3f}')

    result = result.reset_index()
    result.to_csv(OUT_CSV, index=False)
    print(f'Wrote {len(result)} rows to {OUT_CSV}')


if __name__ == '__main__':
    main()
