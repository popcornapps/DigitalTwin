"""Generates historical data for 8 new process parameters - Inlet Air
Humidity, Exhaust Air Temperature, Filter Differential Pressure, Shaker/
Vibration Frequency, Product Bed Temperature, Chamber Differential Pressure,
AHU Damper Position, Compressed Air Pressure - for the existing 120
historical batches + PAR-GOLDEN, so there's data to later train the ML
models on all 12 parameters. This script only GENERATES the data - retraining
is a separate future step.

Reads batch metadata (duration, deviation scenario/severity) and the
existing real Temperature/Flow Rate timeseries straight from Postgres - no
CSV involved anywhere, in or out. Writes directly into the new
batch_support_timeseries table (see schema_support_timeseries.sql).

Deterministic and reproducible: every random-looking value is seeded from a
sha256 hash via seeded_gaussian - same scheme already used in
scripts/generate-batch-kpis/generate_batch_kpis.py and
app/live/history_writer.py. Running this script twice produces identical
output.

Values are synthetic/engineered, not measured - designed to be physically
plausible for paracetamol fluid-bed drying and correlated with each batch's
own REAL Temperature/Flow Rate values and real fault scenario, not
independent random noise:
- Exhaust Air Temperature & Product Bed Temperature are derived FROM the
  batch's real Temperature curve (running cooler, closing the gap as drying
  finishes) - they naturally inherit a Temperature-fault batch's drift for
  free, since they're computed from the already-drifted real values.
- Chamber Differential Pressure tracks the batch's real Flow Rate directly.
- Filter Differential Pressure rises steadily across the batch (filter
  loading) and gets extra drift for FlowRate/Pressure/Correlated-fault
  batches, scaled by severity (Warning/Critical).
- AHU Damper Position responds to Filter DP (opens up as it loads).
- Inlet Air Humidity is steady/ambient - not tied to the process or any
  fault, since it's outside air.
- Shaker/Vibration Frequency and Compressed Air Pressure follow a periodic
  filter-cleaning burst cycle (per-batch phase offset), independent of
  scenario.

Phase timing note: the original TypeScript generator's exact per-minute
phase boundaries (dispensing_end/drying_end/etc.) were never saved anywhere
retrievable - only each batch's total duration was. This script reconstructs
APPROXIMATE boundaries by scaling the nominal phase durations
(NOMINAL_PHASE_DURATIONS, matching app/live/config.py's own copy) to fit
each batch's real, already-known duration, rather than reproducing the
original's exact per-batch jitter.
"""
import hashlib
import math
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT))

from app.db import get_connection  # noqa: E402

# --- Same deterministic-noise scheme as generate_batch_kpis.py / history_writer.py ---


def seeded_unit_interval(seed: str) -> float:
    digest = hashlib.sha256(seed.encode()).digest()
    return int.from_bytes(digest[:8], 'big') / 2**64


def seeded_gaussian(seed: str, mean: float, std: float) -> float:
    u1 = max(seeded_unit_interval(seed + '_u1'), 1e-9)
    u2 = seeded_unit_interval(seed + '_u2')
    z = math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)
    return mean + z * std


def clamp(lo: float, hi: float, x: float) -> float:
    return max(lo, min(hi, x))


# Same nominal phase lengths as app/live/config.py's NOMINAL_PHASE_DURATIONS -
# scaled to fit each batch's real, already-known total duration (see module
# docstring: the original per-batch jitter wasn't retrievable, only the total).
NOMINAL_PHASE_DURATIONS = {
    'dispensing': 25, 'dry_mixing': 20, 'wet_massing': 25, 'transfer': 15, 'drying': 270, 'cooling': 30,
}
NOMINAL_TOTAL_DURATION = sum(NOMINAL_PHASE_DURATIONS.values())  # 385

SEVERITY_MULTIPLIER = {'Normal': 0.0, 'Warning': 0.5, 'Critical': 1.0}

BURST_INTERVAL_MINUTES = 45.0
BURST_DURATION_MINUTES = 12.0


def phase_boundaries(duration: int) -> dict:
    scale = duration / NOMINAL_TOTAL_DURATION
    boundaries, cumulative = {}, 0.0
    for phase, minutes in NOMINAL_PHASE_DURATIONS.items():
        cumulative += minutes * scale
        boundaries[phase] = cumulative
    return boundaries


def mean_reverting_walk(seed_prefix: str, minutes: list, baseline_at, noise_std: float, reversion_rate: float = 0.15) -> list:
    """Same mean-reverting-walk shape as app/live/simulator.py's noise model,
    computed once for a whole (already-finished) batch rather than tick by
    tick - gives a smooth, realistic-looking trace instead of jagged
    independent-per-minute noise."""
    values = []
    state = 0.0
    for i, t in enumerate(minutes):
        shock = seeded_gaussian(f'{seed_prefix}_{t}', 0.0, noise_std)
        state = state + reversion_rate * (0.0 - state) + shock
        values.append(baseline_at(i, t) + state)
    return values


def fault_scenario_param(deviation_scenario) -> str | None:
    """The 17-name historical fault catalog is named '{Parameter}_{FaultType}'
    (e.g. 'Temperature_HeatExchangerFouling') or 'Correlated_DryerRestriction'
    - only the parameter prefix matters here, to decide which of the 8 new
    parameters should show extra correlated drift. batches.deviation_scenario
    is stored as the literal text 'None' for Normal batches, not real NULL."""
    if deviation_scenario in (None, 'None'):
        return None
    return deviation_scenario.split('_')[0]


def generate_batch_support_timeseries(
    batch_id: str, duration: int, deviation_scenario, deviation_severity, temperature: dict, flow_rate: dict
) -> list[tuple]:
    """temperature/flow_rate: {elapsed_minutes: value} from the batch's REAL
    batch_timeseries rows - the new signals correlate against these real
    values, not an independent re-simulation."""
    boundaries = phase_boundaries(duration)
    severity_key = 'Normal' if deviation_severity in (None, 'None') else deviation_severity
    severity_mult = SEVERITY_MULTIPLIER.get(severity_key, 0.0)
    fault_param = fault_scenario_param(deviation_scenario)
    minutes = sorted(temperature.keys())

    # --- Filter Differential Pressure: rises steadily across the whole
    # batch (filter gradually clogs); extra drift if this batch's fault is
    # airflow/pressure/correlated related. ---
    filter_extra = severity_mult * (
        8.0 if fault_param == 'Correlated' else 6.0 if fault_param == 'FlowRate' else 5.0 if fault_param == 'Pressure' else 0.0
    )

    def filter_dp_baseline(_i, t):
        frac = t / duration if duration else 0.0
        return 3.0 + (20.0 - 3.0) * frac + filter_extra * frac

    filter_dp = [clamp(1.0, 40.0, v) for v in mean_reverting_walk(f'{batch_id}_filter_dp', minutes, filter_dp_baseline, 0.8)]

    # --- Chamber/Bed Differential Pressure: tracks the batch's real Flow Rate. ---
    chamber_extra = severity_mult * (6.0 if fault_param == 'Correlated' else 4.0 if fault_param == 'Pressure' else 0.0)

    def chamber_dp_baseline(_i, t):
        frac = t / duration if duration else 0.0
        return 0.30 * flow_rate.get(t, 48.5) + 0.01 * t + chamber_extra * frac

    chamber_dp = [clamp(0.0, 45.0, v) for v in mean_reverting_walk(f'{batch_id}_chamber_dp', minutes, chamber_dp_baseline, 0.6)]

    # --- AHU Damper Position: opens up as Filter DP rises (control response). ---
    def damper_baseline(i, _t):
        return 50.0 + 1.2 * (filter_dp[i] - 3.0)

    damper = [clamp(0.0, 100.0, v) for v in mean_reverting_walk(f'{batch_id}_damper', minutes, damper_baseline, 1.5)]

    # --- Exhaust Air Temperature & Product Bed Temperature: derived FROM the
    # batch's real Temperature - naturally inherit Temperature-fault drift
    # for free, since they're computed from the already-drifted real values. ---
    transfer_end, drying_end = boundaries['transfer'], boundaries['drying']

    drying_duration = drying_end - transfer_end
    gap_rise_window = min(0.15 * drying_duration, 40.0) if drying_duration > 0 else 0.0
    gap_rise_end = transfer_end + gap_rise_window

    def gap_at(t, pre_drying_gap, gap_start_val, gap_end_val):
        # Before drying air actually starts flowing (dispensing/mixing/
        # transfer), there's no strong evaporative-cooling effect yet, so
        # Exhaust/Bed only trail real Temperature by a small fixed amount -
        # NOT the large drying-phase gap, which would (and did) drag them
        # below real Temperature's own low pre-heating values and hit the
        # floor clamp. Once drying air starts, the gap ramps UP to its peak
        # over gap_rise_window (hot air arrives before the exhaust duct/bed
        # catch up) rather than jumping there instantly - an instant jump
        # (the previous version) drove Exhaust/Bed straight into the floor
        # clamp and pinned them flat there for ~15-20 real minutes, which
        # looked like a sensor that had stopped responding, not a batch.
        if t <= transfer_end:
            return pre_drying_gap
        if t <= gap_rise_end and gap_rise_window > 0:
            frac = (t - transfer_end) / gap_rise_window
            return pre_drying_gap + (gap_start_val - pre_drying_gap) * frac
        if t >= drying_end:
            return gap_end_val
        frac = (t - gap_rise_end) / (drying_end - gap_rise_end) if drying_end > gap_rise_end else 1.0
        return gap_start_val + (gap_end_val - gap_start_val) * frac

    correlated_extra = severity_mult * 10.0 if fault_param == 'Correlated' else 0.0

    def exhaust_baseline(_i, t):
        frac = t / duration if duration else 0.0
        return temperature.get(t, 65.5) - gap_at(t, 3.0, 25.0, 8.0) - correlated_extra * frac

    def bed_baseline(_i, t):
        frac = t / duration if duration else 0.0
        return temperature.get(t, 65.5) - gap_at(t, 4.0, 27.0, 5.0) - correlated_extra * frac

    exhaust_temp = [clamp(20.0, 70.0, v) for v in mean_reverting_walk(f'{batch_id}_exhaust_temp', minutes, exhaust_baseline, 0.5)]
    bed_temp = [clamp(20.0, 70.0, v) for v in mean_reverting_walk(f'{batch_id}_bed_temp', minutes, bed_baseline, 0.6)]

    # --- Inlet Air Humidity: steady/ambient - not tied to the process or any fault. ---
    humidity = [clamp(10.0, 35.0, v) for v in mean_reverting_walk(f'{batch_id}_humidity', minutes, lambda _i, _t: 20.0, 1.5)]

    # --- Shaker/Vibration Frequency: mostly idle, short bursts on a fixed
    # filter-cleaning cadence, with a small per-batch phase offset. ---
    burst_offset = seeded_unit_interval(f'{batch_id}_shaker_offset') * BURST_INTERVAL_MINUTES
    shaker, compressed_air = [], []
    for t in minutes:
        phase_pos = (t + burst_offset) % BURST_INTERVAL_MINUTES
        in_burst = phase_pos < BURST_DURATION_MINUTES
        if in_burst:
            bump_frac = 1.0 - abs((phase_pos / BURST_DURATION_MINUTES) - 0.5) * 2
            shaker_base = 2.0 + 6.0 * bump_frac
        else:
            shaker_base = 0.3
        shaker.append(max(0.0, shaker_base + seeded_gaussian(f'{batch_id}_shaker_{t}', 0.0, 0.4)))

        # --- Compressed Air Pressure: steady plant supply, dips exactly
        # during shaker bursts. ---
        dip = 0.8 if in_burst else 0.0
        compressed_air.append(clamp(4.0, 7.5, 6.0 - dip + seeded_gaussian(f'{batch_id}_air_{t}', 0.0, 0.12)))

    return [
        (
            batch_id, t,
            round(humidity[i], 2),
            round(exhaust_temp[i], 2),
            round(filter_dp[i], 2),
            round(shaker[i], 2),
            round(bed_temp[i], 2),
            round(chamber_dp[i], 2),
            round(damper[i], 2),
            round(compressed_air[i], 2),
        )
        for i, t in enumerate(minutes)
    ]


def main():
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('SELECT batch_id, batch_duration_minutes, deviation_scenario, deviation_severity FROM batches')
            batches = cur.fetchall()

            cur.execute('TRUNCATE TABLE batch_support_timeseries')

            total_rows = 0
            for batch_id, duration, deviation_scenario, deviation_severity in batches:
                cur.execute(
                    'SELECT elapsed_minutes, temperature, flow_rate FROM batch_timeseries WHERE batch_id = %s',
                    (batch_id,),
                )
                ts_rows = cur.fetchall()
                temperature = {r[0]: r[1] for r in ts_rows}
                flow_rate = {r[0]: r[2] for r in ts_rows}

                rows = generate_batch_support_timeseries(
                    batch_id, int(duration), deviation_scenario, deviation_severity, temperature, flow_rate
                )
                cur.executemany(
                    """
                    INSERT INTO batch_support_timeseries (
                        batch_id, elapsed_minutes, inlet_air_humidity_pct, exhaust_air_temp_c,
                        filter_differential_pressure_mbar, shaker_vibration_frequency_hz,
                        product_bed_temp_c, chamber_differential_pressure_mbar,
                        ahu_damper_position_pct, compressed_air_pressure_bar
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    rows,
                )
                total_rows += len(rows)
        conn.commit()
        print(f'Inserted {total_rows} rows across {len(batches)} batches into batch_support_timeseries.')
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    main()
