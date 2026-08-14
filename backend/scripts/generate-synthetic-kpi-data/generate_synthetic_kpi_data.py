"""Generates synthetic training data for the KPI Prediction & Deviation Agent
(Yield, Quality Score, SEC, OEE, Total Energy - predicted as the batch's FINAL
outcome, from the last 30 minutes of process parameters available at any
point during the batch).

Why synthetic, and why not reuse data/paracetamol_batch_kpis.csv: those KPIs
are batch-level constants with no real within-batch temporal signal (see
docs/batch-kpis-prediction-readiness-review.md) - there is no real mechanism
tying "what Temperature looked like for the last 30 minutes" to "what Yield
will be", so no model can learn that relationship from the real data. This
generator instead defines that relationship explicitly.

End-of-batch, not 30-min-ahead: earlier versions of this generator predicted
a KPI "snapshot" 30 minutes into the future, mirroring the Process Parameter
Deviation Agent's rolling horizon. That was the wrong framing - Yield/Quality
Score/SEC/OEE/Total Energy are inherently single, end-of-batch outcomes (a
batch has one final yield, not a yield-at-every-minute), unlike Temperature/
Pressure/Flow Rate/Agitator RPM, which are genuinely continuous signals.
Predicting a batch's final outcome from in-process data ("soft sensing") is
standard practice in batch-manufacturing ML. The model's INPUT is unchanged
(still the last 30-minute trailing window of process parameters, same
feature engineering as the Process Parameter model) - only the label
changed: every row generated from a given batch (at whatever elapsed minute
it was sampled) shares that batch's one final-outcome label.

A real formula chain, not independent per-KPI formulas: an earlier version of
this generator computed each KPI independently from raw parameter deviation
(a weighted sum per KPI), which skipped the real physical dependency chain
entirely - no Actual Output, no duration-dependent Energy, no mechanical link
between SEC and Yield. This version mirrors the real historical generator's
actual chain (scripts/generate-batch-kpis/generate_batch_kpis.py):
  stability -> yield_fraction -> actual_output_kg -> yield_pct
  (duration, stability) -> total_energy_kwh -> sec_kwh_per_kg = energy/actual_output_kg
  stability -> assay_pct -> quality_score_pct
  duration -> oee_availability_pct; combined with performance/quality -> oee_pct
fed by synthetic per-parameter deviation scores in place of real measurements.
Constants (BASE_ENERGY_KWH, YIELD_LOSS_COEFF, ASSAY_STABILITY_COEFF, etc.) are
reused directly from that real generator where they're generic to the
process, not re-derived from scratch.

Process parameters do NOT sit near a single fixed "golden" value for the
whole batch - e.g. Flow Rate is legitimately 0 before the transfer phase,
Agitator RPM is legitimately 0 during drying (see backend/app/live/
simulator.py's baseline curves). This generator ports that file's
phase-boundary/baseline-curve logic so "deviation" is always measured
against the phase-correct expected value - the same "ported, not imported,
kept in sync by hand" convention that file and backend/app/live/config.py
already use.

12 parameters, not 4 (updated for the Step 1/3 process-parameter expansion):
the ORIGINAL 4 (Temperature/Process Pressure/Flow Rate/Agitator RPM) still
drive the core of the KPI formula chain below, unchanged. As of the
12-parameter causal-formula revision (GENERATION_METHOD_VERSION
'v6-12param-causal8'), 4 of the 8 added parameters ALSO carry a small,
independent causal weight - Filter Differential Pressure, Shaker Vibration
Frequency, Inlet Air Humidity, Compressed Air Pressure - see
compute_final_kpis's FILTER_DP_*/SHAKER_*/HUMIDITY_*/COMPRESSED_AIR_*
coefficients below. These 4 were chosen because their baseline/noise is
generated independently of the original 4 (not derived from another
parameter's instantaneous value), so their own deviation score is a genuine
independent signal, not a correlated pass-through. The remaining 4 -
Exhaust Air Temp, Product Bed Temp, Chamber Differential Pressure, AHU
Damper Position - are still deliberately given NO causal weight: their
baseline is computed FROM Temperature's or Flow Rate's own instantaneous
value every tick (see below), so they already show a correlated deviation
whenever Temperature/Flow Rate drifts; giving them their own additional KPI
weight on top of that would double-count the same root cause under two
names. All new coefficients are small relative to the original 4's weights
and each is capped via min(1.0, deviation_score) - the same clipping
convention already used for agitator_dev - so no single new parameter (or
combination) can approach the original 4's influence even in a rare
multi-fault batch. It DOES give the model their values as additional
correlated input signal - the same real correlations already used in
scripts/generate-support-parameters/generate_support_parameters.py (history)
and app/live/simulator.py (live): Exhaust/Product Bed Temp track Temperature,
Chamber Differential Pressure tracks Flow Rate, Filter Differential Pressure
rises over the batch (+ extra drift if Flow Rate/Process Pressure is the
drifting scenario), AHU Damper Position responds to Filter DP, Inlet Air
Humidity is flat/ambient, Shaker Vibration + Compressed Air Pressure follow a
periodic filter-cleaning burst cycle - ported a third time here, same
"ported, not imported" convention.

Deliberately NOT changed alongside this revision: scripts/generate-batch-kpis/
generate_batch_kpis.py (the REAL historical generator, whose 0.6/0.2/0.2
assay weights and PAR-GOLDEN's own already-recorded Quality Score/Assay stay
exactly as before) and app/live/kpi_prediction_agent.py's explanation layer
(KPI_PARAMETER_WEIGHTS etc., still 4-parameter-only until the new model is
validated). The new coefficients below are added ON TOP of the existing core
weights (temperature/pressure/flow's 0.6/0.2/0.2 for assay, 0.35/0.15 for
yield, 0.5 for energy instability are all untouched), not a renormalization
of them - a strict superset of the historical/explanation-layer formulas at
zero deviation on the new 8, so no change to the real historical dataset is
required.

Entirely self-contained otherwise: does not read, import, or depend on any
existing data/model file used by the real parameter-prediction pipeline
(paracetamol_batch_timeseries.csv, paracetamol_training_dataset.csv,
paracetamol_random_forest.joblib, paracetamol_golden_envelope.csv, etc.) or
the app.live/app.services live-agent code - it reaches into Postgres only to
WRITE its own output table, via app.db's generic connection helper.

Output: inserts feature+target rows directly into the Postgres table
synthetic_kpi_training_dataset_12param (see
scripts/postgres-migration/schema_synthetic_kpi_training_dataset_12param.sql)
- no CSV/JSON files, unlike the version of this script that predates the
12-parameter expansion. scripts/train-synthetic-kpi-model/
train_synthetic_kpi_model_12param.py reads straight from that table.
"""
import math
import sys
from pathlib import Path

import numpy as np

BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT))

from app.db import get_connection  # noqa: E402

GENERATION_METHOD_VERSION = 'v7-12param-causal8-noisefloor'

# The live-batch subsystem this agent serves only ever simulates one plant
# and one product (backend/app/live/config.py's PLANTS list and
# registry.py's hardcoded product string) - there is no other plant/product
# in this system for the model to be trained on or applied to. Recorded here
# for traceability, not used as a training feature (a constant column would
# add no signal since nothing else varies).
PLANT = 'Hyderabad Plant'
PRODUCT = 'Paracetamol 500mg'

PARAMETER_KEYS = (
    'temperature', 'process_pressure', 'flow_rate', 'agitator_rpm',
    'inlet_air_humidity', 'exhaust_air_temp', 'filter_differential_pressure',
    'shaker_vibration_frequency', 'product_bed_temp', 'chamber_differential_pressure',
    'ahu_damper_position', 'compressed_air_pressure',
)

# Only upper_limit/lower_limit are used (as the normalization scale for the
# deviation score) - the phase-correct expected value at any instant comes
# from the baseline-curve functions further down, not a flat target. The 8
# new parameters' limits match the real Postgres `parameters` table rows
# added in Step 1 (scripts/generate-support-parameters/).
PARAMETER_CONFIG = {
    'temperature': {'lower_limit': 63.0, 'upper_limit': 67.0},
    'process_pressure': {'lower_limit': 1.1, 'upper_limit': 1.3},
    'flow_rate': {'lower_limit': 45.0, 'upper_limit': 52.0},
    'agitator_rpm': {'lower_limit': 20.0, 'upper_limit': 24.0},
    'inlet_air_humidity': {'lower_limit': 15.0, 'upper_limit': 30.0},
    'exhaust_air_temp': {'lower_limit': 35.0, 'upper_limit': 60.0},
    'filter_differential_pressure': {'lower_limit': 3.0, 'upper_limit': 20.0},
    'shaker_vibration_frequency': {'lower_limit': 0.0, 'upper_limit': 10.0},
    'product_bed_temp': {'lower_limit': 38.0, 'upper_limit': 60.0},
    'chamber_differential_pressure': {'lower_limit': 5.0, 'upper_limit': 25.0},
    'ahu_damper_position': {'lower_limit': 40.0, 'upper_limit': 70.0},
    'compressed_air_pressure': {'lower_limit': 5.0, 'upper_limit': 7.0},
}

LOOKBACK_MINUTES = 30  # input window size only - there is no prediction horizon anymore

N_BATCHES = 600

# --- Phase boundaries / baseline curves - ported from backend/app/live/
# simulator.py's BatchSimulator (see module docstring for why). ---
NOMINAL_PHASE_DURATIONS = {'dispensing': 25, 'dry_mixing': 20, 'wet_massing': 25, 'transfer': 15, 'drying': 270, 'cooling': 30}
NOMINAL_TOTAL_DURATION = sum(NOMINAL_PHASE_DURATIONS.values())  # 385 - the "ideal" reference duration for OEE Availability

BURST_INTERVAL_MINUTES = 45.0
BURST_DURATION_MINUTES = 12.0


def _lerp(t, t0, t1, v0, v1):
    if t <= t0:
        return v0
    if t >= t1:
        return v1
    return v0 + (v1 - v0) * ((t - t0) / (t1 - t0))


def _phase_boundaries(rng):
    def jitter(minutes):
        return round(minutes * rng.uniform(0.9, 1.1))

    dispensing_end = jitter(NOMINAL_PHASE_DURATIONS['dispensing'])
    dry_mixing_end = dispensing_end + jitter(NOMINAL_PHASE_DURATIONS['dry_mixing'])
    wet_massing_end = dry_mixing_end + jitter(NOMINAL_PHASE_DURATIONS['wet_massing'])
    transfer_end = wet_massing_end + jitter(NOMINAL_PHASE_DURATIONS['transfer'])
    drying_end = transfer_end + jitter(NOMINAL_PHASE_DURATIONS['drying'])
    cooling_end = drying_end + jitter(NOMINAL_PHASE_DURATIONS['cooling'])
    return {
        'dispensing_end': dispensing_end, 'dry_mixing_end': dry_mixing_end, 'wet_massing_end': wet_massing_end,
        'transfer_end': transfer_end, 'drying_end': drying_end, 'cooling_end': cooling_end,
    }


def _sample_onset(rng, key, b, duration, drifting_params):
    """Earliest point this parameter's meaningful window opens (matches
    backend/app/live/simulator.py's _drift_offset exactly: Agitator RPM's
    only meaningful window is dispensing-end onward; every other parameter -
    including the 8 new ones - starts at transfer_end, roughly when drying
    begins), PLUS a random delay on top for whichever parameter(s) are
    actually drifting.

    This delay matters for realism, not just machine learning: real faults
    (equipment wear, raw material variability, calibration drift) don't all
    begin the instant a parameter's meaningful window opens - some are
    present from the very start of that window, others only develop
    partway through, depending on the actual root cause. Fixing every
    drifting batch's onset to the exact same instant (the earlier version
    of this generator) was the less realistic choice, not a deliberate
    simplification worth keeping. Non-drifting parameters just get the
    plain earliest point - their onset value is never used for anything,
    since drift_offset always returns 0 for a key that isn't in
    drifting_params.

    Reused both for injecting drift during simulation and for measuring
    each parameter's own "final" deviation afterward, so both stages agree
    on which window is meaningful."""
    earliest = b['dispensing_end'] if key == 'agitator_rpm' else b['transfer_end']
    if key not in drifting_params:
        return earliest
    # Agitator RPM's own meaningful window is short (dispensing_end through
    # wet_massing_end) - every other parameter (original + new) stays
    # meaningful all the way to the end of the batch. The delay fraction
    # (0.35, not the wider range tried initially) is a deliberate
    # calibration: too wide, and too many batches end up with almost no
    # informative window left before the batch ends (verified this
    # empirically - an 0.8 fraction pushed 18% of drifting batches past 70%
    # of their own duration before onset, and measurably hurt model
    # accuracy). This keeps onset timing genuinely varied - not locked to
    # one fixed instant like before - while still leaving most batches
    # enough runway afterward to show a learnable pattern.
    latest_meaningful = b['wet_massing_end'] if key == 'agitator_rpm' else duration
    max_delay = max(0.0, (latest_meaningful - earliest) * 0.35)
    return earliest + (float(rng.uniform(0, max_delay)) if max_delay > 0 else 0.0)


def _agitator_rpm_baseline(b, t):
    ramp_to_dry_mix_end = b['dispensing_end'] + 5
    ramp_to_wet_mass_end = b['dry_mixing_end'] + 4
    ramp_down_end = b['wet_massing_end'] + 5
    if t < b['dispensing_end']:
        return 0.0
    if t < ramp_to_dry_mix_end:
        return _lerp(t, b['dispensing_end'], ramp_to_dry_mix_end, 0, 18)
    if t < b['dry_mixing_end']:
        return 18.0
    if t < ramp_to_wet_mass_end:
        return _lerp(t, b['dry_mixing_end'], ramp_to_wet_mass_end, 18, 22)
    if t < b['wet_massing_end']:
        return 22.0
    if t < ramp_down_end:
        return _lerp(t, b['wet_massing_end'], ramp_down_end, 22, 0)
    return 0.0


def _flow_rate_baseline(b, t):
    ramp_up_end = b['transfer_end'] + 7
    ramp_down_end = b['drying_end'] + 8
    if t < b['transfer_end']:
        return 0.0
    if t < ramp_up_end:
        return _lerp(t, b['transfer_end'], ramp_up_end, 0, 48.5)
    if t < b['drying_end']:
        return 48.5
    if t < ramp_down_end:
        return _lerp(t, b['drying_end'], ramp_down_end, 48.5, 0)
    return 0.0


def _process_pressure_baseline(b, t):
    ramp_up_end = b['transfer_end'] + 10
    ramp_down_end = b['drying_end'] + 15
    if t < b['transfer_end']:
        return 1.01
    if t < ramp_up_end:
        return _lerp(t, b['transfer_end'], ramp_up_end, 1.0, 1.2)
    if t < b['drying_end']:
        return 1.2
    if t < ramp_down_end:
        return _lerp(t, b['drying_end'], ramp_down_end, 1.2, 1.0)
    return 1.0


def _temperature_baseline(b, t, current_rpm):
    drying_ramp_end = b['transfer_end'] + 40
    drying_plateau_end = drying_ramp_end + 120
    if t < b['dispensing_end']:
        base = 23.0
    elif t < b['dry_mixing_end']:
        base = _lerp(t, b['dispensing_end'], b['dry_mixing_end'], 23.0, 30.0)
    elif t < b['wet_massing_end']:
        base = _lerp(t, b['dry_mixing_end'], b['wet_massing_end'], 30.0, 34.0)
    elif t < b['transfer_end']:
        base = 34.0
    elif t < drying_ramp_end:
        base = _lerp(t, b['transfer_end'], drying_ramp_end, 34.0, 65.0)
    elif t < drying_plateau_end:
        dip = 1.2 * math.sin((math.pi * (t - drying_ramp_end)) / (drying_plateau_end - drying_ramp_end))
        base = 65.0 - dip
    elif t < b['drying_end']:
        base = _lerp(t, drying_plateau_end, b['drying_end'], 65.0, 66.8)
    elif t < b['cooling_end']:
        base = _lerp(t, b['drying_end'], b['cooling_end'], 66.8, 42.0)
    else:
        base = 42.0
    shear_bump = 0.06 * max(0.0, current_rpm - 18) if b['dry_mixing_end'] <= t < b['wet_massing_end'] else 0.0
    return base + shear_bump


# --- The 8 new parameters' baseline curves - same correlation design as
# scripts/generate-support-parameters/generate_support_parameters.py (history)
# and app/live/simulator.py (live), ported a third time. ---

def _gap_at(b, t, pre_drying_gap, gap_start_val, gap_end_val):
    """Same smooth gap-ramp used in the other two ports: small pre-drying,
    ramping up at drying start, narrowing by drying end - avoids the floor-
    clamp discontinuity an earlier (fixed) version of this design had."""
    transfer_end, drying_end = b['transfer_end'], b['drying_end']
    drying_duration = drying_end - transfer_end
    rise_window = min(0.15 * drying_duration, 40.0) if drying_duration > 0 else 0.0
    rise_end = transfer_end + rise_window
    if t <= transfer_end:
        return pre_drying_gap
    if t <= rise_end and rise_window > 0:
        frac = (t - transfer_end) / rise_window
        return pre_drying_gap + (gap_start_val - pre_drying_gap) * frac
    if t >= drying_end:
        return gap_end_val
    frac = (t - rise_end) / (drying_end - rise_end) if drying_end > rise_end else 1.0
    return gap_start_val + (gap_end_val - gap_start_val) * frac


def _exhaust_air_temp_baseline(b, t, temperature):
    return temperature - _gap_at(b, t, 3.0, 25.0, 8.0)


def _product_bed_temp_baseline(b, t, temperature):
    return temperature - _gap_at(b, t, 4.0, 27.0, 5.0)


def _filter_dp_baseline(b, t, duration, extra_severity):
    frac = t / duration if duration else 0.0
    return 3.0 + (20.0 - 3.0) * frac + extra_severity * frac


def _chamber_dp_baseline(t, flow_rate, extra_severity):
    return 0.30 * flow_rate + 0.01 * t + extra_severity


def _damper_baseline(filter_dp):
    return 50.0 + 1.2 * (filter_dp - 3.0)


# Small, per-batch, per-parameter operating-point offset - drawn ONCE per
# batch (not evolving over time like noise/drift). Represents legitimate
# batch-to-batch variability (raw material lot potency, minor equipment
# calibration) that has nothing to do with a fault. Applied to BOTH the
# actual series and baseline_series together (see _apply_personality and its
# call sites in simulate_parameter_series), so it becomes part of THIS
# batch's own "normal" and never shows up as a deviation in the KPI chain
# below - only in the raw feature values. Without this, every Normal batch
# shared the exact same target curve and differed only by phase-timing
# jitter, which is more uniform than any real plant's batch-to-batch spread.
# Only defined for the original 4 - the 8 new ones are either derived FROM
# these (and so inherit their personality automatically) or independent
# ambient/cyclic signals with no real "operating point" of their own.
BATCH_PERSONALITY_STD = {
    'temperature': 0.2,
    'process_pressure': 0.01,
    'flow_rate': 0.35,
    'agitator_rpm': 0.2,
}


def _apply_personality(base, offset, key):
    """Applies this batch's personality offset to a baseline value, except
    while Agitator RPM/Flow Rate are legitimately powered off (exactly 0
    outside their active phase) - equipment that isn't running has no
    operating point to vary."""
    if key in ('agitator_rpm', 'flow_rate') and base <= 0.0:
        return base
    return base + offset


# Which parameter(s) drift together, weighted so ~26% of batches are clean
# Normal runs - a rough match to the real historical dataset's proportions
# (trimmed slightly from the prior 28% to make room for the 2 new scenarios
# below without shrinking the original 4's coverage much). Four new entries
# (FilterDP_Drift, Shaker_Drift, Humidity_Drift, CompressedAir_Drift) give
# the model realistic examples of all 4 newly-causal parameters (see module
# docstring) deviating INDEPENDENTLY of the original 4 and of each other -
# every parameter that now carries a KPI weight has its own isolated-fault
# training scenario, so the model can learn each one's effect in isolation
# rather than only ever entangled with some other drift. Live batches
# (app/live/registry.py) can select ANY of the 12 parameters as the sole
# drifting_parameter, including these 4 - without a dedicated scenario here,
# the model would never have seen that isolated case at training time.
SCENARIOS = [
    ('Normal', ()),
    ('Temperature_Drift', ('temperature',)),
    ('Pressure_Drift', ('process_pressure',)),
    ('FlowRate_Drift', ('flow_rate',)),
    ('Agitator_Drift', ('agitator_rpm',)),
    ('Correlated_TempAgitator', ('temperature', 'agitator_rpm')),
    ('Correlated_PressureFlow', ('process_pressure', 'flow_rate')),
    ('FilterDP_Drift', ('filter_differential_pressure',)),
    ('Shaker_Drift', ('shaker_vibration_frequency',)),
    ('Humidity_Drift', ('inlet_air_humidity',)),
    ('CompressedAir_Drift', ('compressed_air_pressure',)),
]
SCENARIO_WEIGHTS = [0.26, 0.11, 0.11, 0.11, 0.11, 0.07, 0.07, 0.04, 0.04, 0.04, 0.04]

# Multiple of the parameter's own band half-width that the deviation ramps up
# to by the end of the batch. Each tier is a RANGE, not a fixed point - real
# fault severity sits on a continuum, not 3 identical clusters every time.
# The tier label itself is still drawn categorically (weighted below) and
# used as a coarse bucket for OEE Performance range and duration-extension
# scaling further down - only the multiplier actually driving the drift
# ramp is continuous within its tier's range.
SEVERITY_TIER_RANGES = {'mild': (0.3, 0.9), 'moderate': (0.9, 1.5), 'severe': (1.5, 2.3)}
SEVERITY_WEIGHTS = [0.4, 0.35, 0.25]

# Per-parameter noise std - ported directly from backend/app/live/config.py's
# NOISE_STD (same "ported, not imported, kept in sync by hand" convention
# that file's own header uses), NOT a fraction-of-band heuristic. This
# matters a lot: if this generator's noise were quieter than what the real
# live simulator actually produces, the model would be trained on
# unrealistically "clean" Normal batches, and then misread the real
# simulator's genuinely-normal noise level as instability at inference time
# - inflating deviation scores, and therefore predictions, for perfectly
# normal running batches. Must match the real simulator's scale, not just be
# "some small noise". Split here into an INDEPENDENT component (unique to
# that parameter) plus, for Temperature/Process Pressure only, a COMMON
# component driven by one shared disturbance (see common_state in
# simulate_parameter_series) - a sealed vessel's temperature and headspace
# pressure are physically coupled in reality (e.g. a utility/steam-supply
# fluctuation nudges both together), not independent random walks. The
# independent stds below are reduced just enough that each parameter's TOTAL
# noise level (independent + its share of the common disturbance) still
# lands close to the original NOISE_STD scale referenced above. Shaker
# Vibration Frequency and Compressed Air Pressure aren't listed here - they
# follow their own burst-cycle noise below, not this generic walk (matching
# app/live/simulator.py's same distinction).
INDEPENDENT_NOISE_STD = {
    'temperature': 0.26,
    'process_pressure': 0.009,
    'flow_rate': 0.4,
    'agitator_rpm': 0.5,
    'inlet_air_humidity': 1.5,
    'exhaust_air_temp': 0.5,
    'filter_differential_pressure': 0.8,
    'product_bed_temp': 0.6,
    'chamber_differential_pressure': 0.6,
    'ahu_damper_position': 1.5,
}
COMMON_NOISE_STD = 1.0  # innovation std of the shared disturbance process, in an arbitrary unit - see COMMON_NOISE_WEIGHT for how it maps into each parameter's own units
COMMON_NOISE_WEIGHT = {'temperature': 0.08, 'process_pressure': 0.003}  # Flow Rate/Agitator RPM aren't part of this shared disturbance

# A fault legitimately extends the batch (corrective holds, rework, drying
# stalls) roughly IN PROPORTION to its severity, not as an all-or-nothing
# switch - a moderate fault usually costs some time too, just less than a
# severe one. Coefficient chosen so the old severe tier's former fixed point
# (severity_mult ~= 1.9) lands close to backend/app/live/config.py's
# CRITICAL_DURATION_EXTENSION_MINUTES=80, which this still mirrors at that
# point. Matters because OEE Availability and Total Energy both genuinely
# depend on duration.
DURATION_EXTENSION_PER_SEVERITY_UNIT = 42.0


def _band_half_width(key):
    cfg = PARAMETER_CONFIG[key]
    return (cfg['upper_limit'] - cfg['lower_limit']) / 2


def simulate_parameter_series(rng, drifting_params, severity_mult, directions, duration_extension=0):
    """Returns (series, baseline_series, duration, onset): series[key] is the
    actual (baseline + drift + noise) value at each minute, baseline_series[key]
    is the phase-correct expected value alone (no drift/noise) - kept
    separately so downstream calculations can compute a residual against the
    correct reference at each instant, not a single flat number. onset is the
    per-parameter onset-minute dict (see _sample_onset) - randomized per
    batch for whichever parameter(s) are actually drifting.

    The 8 new parameters are computed from the SAME tick's original-4 values
    (both the drifted/noisy series AND the clean baseline_series) - Exhaust/
    Bed Temp and Chamber DP inherit whatever drift Temperature/Flow Rate
    already have "for free", exactly like the historical and live ports."""
    b = _phase_boundaries(rng)
    duration = b['cooling_end'] + duration_extension
    onset = {key: _sample_onset(rng, key, b, duration, drifting_params) for key in PARAMETER_KEYS}
    personality_offset = {key: float(rng.normal(0, BATCH_PERSONALITY_STD[key])) for key in BATCH_PERSONALITY_STD}
    noise_state = {key: 0.0 for key in PARAMETER_KEYS}
    common_state = 0.0  # shared disturbance driving Temperature/Process Pressure's correlated noise component - see COMMON_NOISE_WEIGHT
    shaker_burst_offset = float(rng.uniform(0, BURST_INTERVAL_MINUTES))

    series = {key: np.zeros(duration + 1) for key in PARAMETER_KEYS}
    baseline_series = {key: np.zeros(duration + 1) for key in PARAMETER_KEYS}

    def noise_step(key):
        noise_state[key] += rng.normal(0, INDEPENDENT_NOISE_STD[key]) - 0.15 * noise_state[key]
        return noise_state[key] + COMMON_NOISE_WEIGHT.get(key, 0.0) * common_state

    def drift_offset(key, t):
        if key not in drifting_params or t < onset[key]:
            return 0.0
        max_deviation = _band_half_width(key) * severity_mult
        ramp_minutes = max(1, duration - onset[key])
        progress = min(1.0, (t - onset[key]) / ramp_minutes)
        return directions[key] * max_deviation * progress

    # Filter DP/Chamber DP get extra correlated drift when Flow Rate/Process
    # Pressure is this batch's drifting scenario - same idea as the
    # historical/live ports' filter_extra/chamber_extra, scaled by this
    # generator's own continuous severity_mult instead of a 3-tier constant.
    filter_extra = severity_mult * 6.0 if 'flow_rate' in drifting_params else severity_mult * 5.0 if 'process_pressure' in drifting_params else 0.0
    chamber_extra = severity_mult * 4.0 if 'process_pressure' in drifting_params else 0.0

    for t in range(duration + 1):
        common_state += rng.normal(0, COMMON_NOISE_STD) - 0.15 * common_state

        agitator_base = _apply_personality(_agitator_rpm_baseline(b, t), personality_offset['agitator_rpm'], 'agitator_rpm')
        flow_base = _apply_personality(_flow_rate_baseline(b, t), personality_offset['flow_rate'], 'flow_rate')
        pressure_base = _apply_personality(_process_pressure_baseline(b, t), personality_offset['process_pressure'], 'process_pressure')

        agitator_rpm = max(0.0, agitator_base + noise_step('agitator_rpm') + drift_offset('agitator_rpm', t))
        flow_rate = max(0.0, flow_base + noise_step('flow_rate') + drift_offset('flow_rate', t))
        process_pressure = max(0.0, pressure_base + noise_step('process_pressure') + drift_offset('process_pressure', t))
        temp_base = _apply_personality(_temperature_baseline(b, t, agitator_rpm), personality_offset['temperature'], 'temperature')
        temperature = temp_base + noise_step('temperature') + drift_offset('temperature', t)

        series['agitator_rpm'][t], baseline_series['agitator_rpm'][t] = agitator_rpm, agitator_base
        series['flow_rate'][t], baseline_series['flow_rate'][t] = flow_rate, flow_base
        series['process_pressure'][t], baseline_series['process_pressure'][t] = process_pressure, pressure_base
        series['temperature'][t], baseline_series['temperature'][t] = temperature, temp_base

        # --- The 8 new parameters ---
        humidity = min(35.0, max(10.0, 20.0 + noise_step('inlet_air_humidity') + drift_offset('inlet_air_humidity', t)))
        exhaust_temp = min(70.0, max(20.0, _exhaust_air_temp_baseline(b, t, temperature) + noise_step('exhaust_air_temp') + drift_offset('exhaust_air_temp', t)))
        bed_temp = min(70.0, max(20.0, _product_bed_temp_baseline(b, t, temperature) + noise_step('product_bed_temp') + drift_offset('product_bed_temp', t)))
        filter_dp = min(40.0, max(1.0, _filter_dp_baseline(b, t, duration, filter_extra) + noise_step('filter_differential_pressure') + drift_offset('filter_differential_pressure', t)))
        chamber_dp = min(45.0, max(0.0, _chamber_dp_baseline(t, flow_rate, chamber_extra) + noise_step('chamber_differential_pressure') + drift_offset('chamber_differential_pressure', t)))
        damper = min(100.0, max(0.0, _damper_baseline(filter_dp) + noise_step('ahu_damper_position') + drift_offset('ahu_damper_position', t)))

        phase_pos = (t + shaker_burst_offset) % BURST_INTERVAL_MINUTES
        in_burst = phase_pos < BURST_DURATION_MINUTES
        shaker_base = (2.0 + 6.0 * (1.0 - abs((phase_pos / BURST_DURATION_MINUTES) - 0.5) * 2)) if in_burst else 0.3
        shaker = max(0.0, shaker_base + rng.normal(0, 0.4) + drift_offset('shaker_vibration_frequency', t))
        compressed_air = min(7.5, max(4.0, 6.0 - (0.8 if in_burst else 0.0) + rng.normal(0, 0.12) + drift_offset('compressed_air_pressure', t)))

        # Baselines for the 8 new parameters (no drift/noise) - derived from
        # the CLEAN baseline series for the original 4, so a residual against
        # them isolates genuine deviation, same principle as the original 4.
        series['inlet_air_humidity'][t], baseline_series['inlet_air_humidity'][t] = humidity, 20.0
        series['exhaust_air_temp'][t], baseline_series['exhaust_air_temp'][t] = exhaust_temp, _exhaust_air_temp_baseline(b, t, temp_base)
        series['product_bed_temp'][t], baseline_series['product_bed_temp'][t] = bed_temp, _product_bed_temp_baseline(b, t, temp_base)
        series['filter_differential_pressure'][t], baseline_series['filter_differential_pressure'][t] = filter_dp, _filter_dp_baseline(b, t, duration, 0.0)
        series['chamber_differential_pressure'][t], baseline_series['chamber_differential_pressure'][t] = chamber_dp, _chamber_dp_baseline(t, flow_base, 0.0)
        series['ahu_damper_position'][t], baseline_series['ahu_damper_position'][t] = damper, _damper_baseline(_filter_dp_baseline(b, t, duration, 0.0))
        series['shaker_vibration_frequency'][t], baseline_series['shaker_vibration_frequency'][t] = shaker, shaker_base
        series['compressed_air_pressure'][t], baseline_series['compressed_air_pressure'][t] = compressed_air, 6.0 - (0.8 if in_burst else 0.0)

    return series, baseline_series, duration, onset


def _window_stats(values):
    """Same population mean/std + OLS-slope-vs-index formulas as
    backend/app/live/ml_bridge.py's _window_stats (itself a port of
    scripts/build-training-dataset/rollingStats.ts) - reimplemented here, not
    imported, to keep this generator fully self-contained from the live/ML
    code."""
    n = len(values)
    current = values[-1]
    mean = values.mean()
    variance = ((values - mean) ** 2).mean()
    std = variance ** 0.5
    minimum = values.min()
    maximum = values.max()
    xbar = (n - 1) / 2
    idx = np.arange(n)
    num = ((idx - xbar) * (values - mean)).sum()
    den = ((idx - xbar) ** 2).sum()
    slope = 0.0 if den == 0 else num / den
    return {'current': current, 'mean': mean, 'std': std, 'min': minimum, 'max': maximum, 'slope': slope}



# A batch with NO drift at all still has real sensor noise on every
# parameter (see INDEPENDENT_NOISE_STD/COMMON_NOISE_STD in
# simulate_parameter_series) - that noise alone gives a nonzero mean_dev/
# spread below even with zero drift, which _deviation_score_from_residual
# used to pass straight through into the (untouched, approved) KPI weight
# formulas. That was the actual root cause of "Normal" batches predicting an
# unrealistically poor Quality/OEE: the deviation score conflated ordinary,
# expected sensor noise with genuine drift, so an entirely healthy batch
# still registered as a real deviation once weighted. The live simulator's
# own noise levels are NOT changed by this - this only recalibrates how the
# SYNTHETIC LABEL GENERATOR scores a given residual trace, and only affects
# training labels, never anything in app/live/.
#
# Fix: measure each parameter's own typical noise-only mean_dev/spread
# (_measure_noise_floor, averaged over many zero-drift simulations using the
# exact same residual/window logic as final_deviation_scores below) and
# subtract that floor before scoring - a batch's noise no longer counts
# against it, but genuine drift (which pushes mean_dev/spread well past the
# noise-only floor) still registers, proportionally, exactly as before.
# Deliberately does NOT touch the approved KPI weight coefficients
# (YIELD_LOSS_COEFF, the 0.6/0.2/0.2 assay weights, FILTER_DP_*/etc.) or
# generate_batch_kpis.py's historical/Golden formulas - this only changes
# what a "deviation score" of a given residual trace MEANS, not how KPIs are
# computed from it.
NOISE_FLOOR_SAMPLE_SEED = 999
NOISE_FLOOR_SAMPLES = 60
_noise_floor_cache: dict | None = None


def _measure_noise_floor(n_samples: int = NOISE_FLOOR_SAMPLES) -> dict:
    """Average (mean_dev, spread) each parameter's residual produces from
    pure sensor noise alone (drifting_params=(), severity_mult=0.0) - the
    same simulate_parameter_series/window/onset logic final_deviation_scores
    uses below, just run standalone and averaged over many seeds so the
    result is a stable expectation, not one noisy sample. Uses its own fixed
    RNG seed, independent of any per-batch generation seed, so this
    calibration is deterministic and reproducible run to run. Cached after
    the first call - the 60-simulation cost is paid once per generate() run,
    not once per batch."""
    global _noise_floor_cache
    if _noise_floor_cache is not None:
        return _noise_floor_cache
    sums = {key: [0.0, 0.0] for key in PARAMETER_KEYS}
    seed_rng = np.random.RandomState(NOISE_FLOOR_SAMPLE_SEED)
    for _ in range(n_samples):
        rng = np.random.RandomState(int(seed_rng.randint(0, 2**31 - 1)))
        directions = {key: 1 for key in PARAMETER_KEYS}  # irrelevant - no drift is ever applied (drifting_params=())
        series, baseline_series, duration, onset = simulate_parameter_series(rng, (), 0.0, directions, 0)
        for key in PARAMETER_KEYS:
            start = int(round(onset[key]))
            residual = series[key][start:duration + 1] - baseline_series[key][start:duration + 1]
            stats = _window_stats(residual)
            half_width = _band_half_width(key)
            sums[key][0] += abs(stats['mean']) / half_width
            sums[key][1] += stats['std'] / half_width
    _noise_floor_cache = {key: (sums[key][0] / n_samples, sums[key][1] / n_samples) for key in PARAMETER_KEYS}
    return _noise_floor_cache


def _deviation_score_from_residual(key, residual_stats):
    """How far a parameter's RESIDUAL (actual minus its own phase-correct
    baseline) is from zero over some window, net of that parameter's own
    typical noise-only floor (see _measure_noise_floor above): 0 = tracking
    its expected curve within normal sensor noise, ~1 = at the edge of the
    normal band beyond that noise, >1 = beyond it. Feeds the KPI formula
    chain below - for the original 4 always, and for
    filter_differential_pressure/shaker_vibration_frequency/
    inlet_air_humidity/compressed_air_pressure since the 12-parameter
    causal-formula revision (see that section's coefficients)."""
    half_width = _band_half_width(key)
    mean_dev = abs(residual_stats['mean']) / half_width
    spread = residual_stats['std'] / half_width
    mean_floor, spread_floor = _measure_noise_floor()[key]
    return max(0.0, mean_dev - mean_floor) + 0.4 * max(0.0, spread - spread_floor)


def final_deviation_scores(series, baseline_series, onset, duration):
    """Each parameter's deviation score over its OWN meaningful window - from
    its onset (when it could first start drifting) through to the end of the
    batch - not the whole 0..duration span, which would dilute the signal
    with a stretch of "before this parameter could even be drifting" padding
    for every parameter uniformly. This is what "how badly did this batch
    actually turn out" is computed from."""
    scores = {}
    for key in PARAMETER_KEYS:
        start = int(round(onset[key]))  # onset can be fractional now (randomized delay) - slicing needs an int
        residual = series[key][start:duration + 1] - baseline_series[key][start:duration + 1]
        scores[key] = _deviation_score_from_residual(key, _window_stats(residual))
    return scores


# --- Final KPI formula chain - mirrors scripts/generate-batch-kpis/
# generate_batch_kpis.py's real chain (Process Parameters -> Process
# Stability -> Yield/Energy/Assay -> OEE), fed by the synthetic deviation
# scores above instead of real measurements. Constants reused directly from
# that real generator where they're generic to the process, not arbitrary.
# The core chain is still keyed to the original 4 parameters, exactly
# matching generate_batch_kpis.py; the 4 newly-causal support parameters
# (FILTER_DP_*/SHAKER_*/HUMIDITY_*/COMPRESSED_AIR_* below) are added on top -
# see module docstring's 12-parameter causal-formula revision section. ---
THEORETICAL_OUTPUT_KG = 150.0  # matches the real per-product constant (single product today)
BASE_ENERGY_KWH = 180.0
ENERGY_PER_MINUTE_KWH = 0.16
ENERGY_NOISE_STD_KWH = 3.0
ENERGY_INSTABILITY_COEFF = 0.5
YIELD_LOSS_COEFF = 0.35
YIELD_LOSS_NOISE_STD = 0.01
YIELD_FRACTION_FLOOR = 0.85
# New vs. the real generator - Agitator RPM is excluded from stability_frac
# (matching the real process_stability_pct convention, which is Temperature/
# Pressure/Flow Rate only), so it gets its own separate yield-loss term here
# instead, preserving the "Agitator RPM affects Yield via mixing/dosing
# consistency" domain intuition.
AGITATOR_YIELD_COEFF = 0.15

# --- 12-parameter causal-formula revision (v6-12param-causal8) - see module
# docstring for which 4 of the 8 added parameters get a weight here and why
# (independent-origin baseline, not derived from another parameter's
# instantaneous value) and why the other 4 don't (would double-count).
# Added ON TOP of the untouched core weights above/below, not carved out of
# them - approved via the KPI-formula-revision review; each coefficient is
# small relative to its corresponding core term and every new deviation
# score is clipped to [0, 1] (min(1.0, ...) at the call site) before being
# multiplied by its coefficient, the same convention AGITATOR_YIELD_COEFF's
# agitator_dev_clipped already uses, so no new parameter can swing a KPI
# anywhere near as far as the original 4 even in a rare multi-fault batch. ---
FILTER_DP_YIELD_COEFF = 0.03     # loaded filter -> product loss/rework
SHAKER_YIELD_COEFF = 0.02        # excess vibration -> fines loss through filter media
FILTER_DP_ASSAY_COEFF = 0.03     # loaded filter -> uneven bed drying -> assay drift
SHAKER_ASSAY_COEFF = 0.02        # excess vibration -> particle-size/content-uniformity impact
HUMIDITY_ASSAY_COEFF = 0.02      # humid inlet air -> under-dried product risk
FILTER_DP_ENERGY_COEFF = 0.06    # loaded filter -> blower/fan works harder (largest new term - most direct mechanism)
HUMIDITY_ENERGY_COEFF = 0.04     # humid inlet air -> reduced drying driving force -> more energy to reach dryness
COMPRESSED_AIR_ENERGY_COEFF = 0.02  # low instrument air -> poor filter pulse-cleaning -> back into the filter-DP energy chain

ASSAY_TARGET_PCT = 100.0
ASSAY_SPEC_HALF_WIDTH = 5.0  # confirmed from the real data/paracetamol_parameter_config.csv's Assay row (target=100, upper=105)
ASSAY_STABILITY_COEFF = 2.0
ASSAY_NOISE_STD = 0.3
ASSAY_FLOOR_PCT = 90.0
ASSAY_CEILING_PCT = 101.0
QUALITY_SCORE_NORMALIZATION_SPAN = 10.0
# Real OEE_PERFORMANCE_RANGES mapped onto this generator's 4 severity tiers
# (Normal + mild/moderate/severe, vs. the real dataset's Normal/Warning/
# Critical) - mild interpolated between Normal and the real "Warning" range.
OEE_PERFORMANCE_RANGES = {'Normal': (90.0, 98.0), 'mild': (86.0, 95.0), 'moderate': (82.0, 92.0), 'severe': (75.0, 88.0)}

TARGET_COLUMNS = ['yield_pct_final', 'quality_score_pct_final', 'sec_kwh_per_kg_final', 'oee_pct_final', 'total_energy_kwh_final']

# A row sampled before any of a batch's drifting parameters has reached its
# own onset is genuinely unpredictable from its input alone: two batches -
# one that stays Normal, one that will eventually drift - look statistically
# identical during that period, yet carry different final-outcome labels.
# That's not something a bigger/better model can fix (the information isn't
# there yet), but training on those rows at full weight still forces the
# model to spend capacity trying to fit noise it can't win against. Giving
# them a reduced (not zero) weight lets training focus more on the part of
# each batch that actually carries a learnable signal, without pretending
# those early rows don't exist at all. Normal batches (no onset at all) are
# NOT down-weighted - "stays Normal" is genuinely the correct, learnable
# answer from any point in a Normal batch, unlike a drifting batch's
# pre-onset window.
#
# This was previously a hard cutoff: AMBIGUOUS_ROW_WEIGHT strictly before
# onset, full weight 1.0 from onset onward - including the very next minute
# after onset. But the label a row must predict is still THE SAME single
# final-batch outcome regardless of how far the drift has actually ramped by
# the row's own elapsed minute (drift ramps linearly from onset to the
# batch's end - see drift_offset above) - a row taken one minute past onset
# has a 30-minute window that looks almost identical to a non-drifting one,
# yet was being trained at full weight to predict the full eventual severity.
# _row_weight below replaces the hard cutoff with a taper: weight rises
# linearly from AMBIGUOUS_ROW_WEIGHT at the moment of onset up to 1.0 by the
# batch's end, so training loss is concentrated where the window actually
# carries the signal needed to predict the label it's paired with. The input
# window and the final-outcome label themselves are UNCHANGED by this - only
# how much each row counts during training/evaluation.
AMBIGUOUS_ROW_WEIGHT = 0.15
WEIGHT_COLUMN = 'row_weight'


def _row_weight(t: int, batch_onset_minute: float | None, duration: int) -> float:
    if batch_onset_minute is None:
        return 1.0  # Normal batch - "stays Normal" is the correct answer from any point
    onset = float(batch_onset_minute)  # onset can be a numpy float64 (from rng.uniform) - psycopg2 can't adapt that
    if t < onset:
        return AMBIGUOUS_ROW_WEIGHT
    ramp_span = max(1.0, duration - onset)
    progress = min(1.0, (t - onset) / ramp_span)
    return float(AMBIGUOUS_ROW_WEIGHT + (1.0 - AMBIGUOUS_ROW_WEIGHT) * progress)


def compute_final_kpis(rng, deviation_scores, duration, severity_tier):
    """The full chain: intermediate physical values first (stability_frac,
    actual_output_kg, total_energy_kwh, assay_pct), final KPIs derived FROM
    those - not computed independently per KPI. See module docstring. Core
    chain reads the original 4 parameters' deviation scores; the 4
    newly-causal support parameters (Filter DP/Shaker/Humidity/Compressed
    Air) are added on top - see the 12-parameter causal-formula revision
    coefficients above."""
    stability_frac = float(np.clip(
        1.0 - np.mean([deviation_scores['temperature'], deviation_scores['process_pressure'], deviation_scores['flow_rate']]),
        0.0, 1.0,
    ))
    agitator_dev_clipped = min(1.0, deviation_scores['agitator_rpm'])
    # The 4 newly-causal support parameters (see module docstring + the
    # coefficient block above) - each clipped to [0, 1] before being weighted,
    # same convention as agitator_dev_clipped.
    filter_dp_dev_clipped = min(1.0, deviation_scores['filter_differential_pressure'])
    shaker_dev_clipped = min(1.0, deviation_scores['shaker_vibration_frequency'])
    humidity_dev_clipped = min(1.0, deviation_scores['inlet_air_humidity'])
    compressed_air_dev_clipped = min(1.0, deviation_scores['compressed_air_pressure'])

    yield_loss_frac = (
        YIELD_LOSS_COEFF * (1 - stability_frac) + AGITATOR_YIELD_COEFF * agitator_dev_clipped
        + FILTER_DP_YIELD_COEFF * filter_dp_dev_clipped + SHAKER_YIELD_COEFF * shaker_dev_clipped
    )
    yield_fraction = float(np.clip(1.0 - yield_loss_frac + rng.normal(0, YIELD_LOSS_NOISE_STD), YIELD_FRACTION_FLOOR, 1.0))
    actual_output_kg = THEORETICAL_OUTPUT_KG * yield_fraction
    yield_pct_final = 100.0 * yield_fraction

    instability_penalty = (
        ENERGY_INSTABILITY_COEFF * (1 - stability_frac)
        + FILTER_DP_ENERGY_COEFF * filter_dp_dev_clipped + HUMIDITY_ENERGY_COEFF * humidity_dev_clipped
        + COMPRESSED_AIR_ENERGY_COEFF * compressed_air_dev_clipped
    )
    total_energy_kwh_final = (
        BASE_ENERGY_KWH + ENERGY_PER_MINUTE_KWH * duration * (1 + instability_penalty) + rng.normal(0, ENERGY_NOISE_STD_KWH)
    )
    sec_kwh_per_kg_final = total_energy_kwh_final / actual_output_kg  # mechanically tied to Yield, not independent

    # Temperature-weighted (not equal-weighted like the real generator's
    # stability_frac) - preserves the domain intuition that Temperature
    # dominates Quality Score, while still routing through the same
    # stability -> assay -> quality chain shape as the real data. The core
    # 0.6/0.2/0.2 term is untouched (matches generate_batch_kpis.py exactly);
    # the 3 new terms are added on top, not carved out of it - see the
    # coefficient block above for why.
    assay_relevant_dev = (
        0.6 * deviation_scores['temperature'] + 0.2 * deviation_scores['process_pressure'] + 0.2 * deviation_scores['flow_rate']
        + FILTER_DP_ASSAY_COEFF * filter_dp_dev_clipped + SHAKER_ASSAY_COEFF * shaker_dev_clipped + HUMIDITY_ASSAY_COEFF * humidity_dev_clipped
    )
    assay_stability = float(np.clip(1.0 - assay_relevant_dev, 0.0, 1.0))
    assay_deviation = ASSAY_STABILITY_COEFF * (1 - assay_stability) * ASSAY_SPEC_HALF_WIDTH
    assay_pct = float(np.clip(ASSAY_TARGET_PCT - assay_deviation + rng.normal(0, ASSAY_NOISE_STD), ASSAY_FLOOR_PCT, ASSAY_CEILING_PCT))
    quality_score_pct_final = 100.0 * (1 - min(1.0, abs(assay_pct - ASSAY_TARGET_PCT) / QUALITY_SCORE_NORMALIZATION_SPAN))

    oee_availability_pct = min(100.0, 100.0 * NOMINAL_TOTAL_DURATION / duration)
    perf_lo, perf_hi = OEE_PERFORMANCE_RANGES[severity_tier or 'Normal']
    oee_performance_pct = float(rng.uniform(perf_lo, perf_hi))
    oee_quality_pct = quality_score_pct_final
    oee_pct_final = (oee_availability_pct * oee_performance_pct * oee_quality_pct) / 10000.0

    return {
        'yield_pct_final': round(yield_pct_final, 3),
        'quality_score_pct_final': round(quality_score_pct_final, 3),
        'sec_kwh_per_kg_final': round(sec_kwh_per_kg_final, 4),
        'oee_pct_final': round(oee_pct_final, 3),
        'total_energy_kwh_final': round(total_energy_kwh_final, 2),
    }


def build_feature_row(elapsed_minutes, window_by_param):
    row = {'elapsed_minutes': elapsed_minutes}
    for key in PARAMETER_KEYS:
        stats = _window_stats(window_by_param[key])
        row[f'{key}_current'] = round(float(stats['current']), 4)
        row[f'{key}_mean_30'] = round(float(stats['mean']), 4)
        row[f'{key}_std_30'] = round(float(stats['std']), 4)
        row[f'{key}_min_30'] = round(float(stats['min']), 4)
        row[f'{key}_max_30'] = round(float(stats['max']), 4)
        row[f'{key}_slope_30'] = round(float(stats['slope']), 4)
    return row


FEATURE_COLUMNS = ['elapsed_minutes'] + [
    f'{key}_{stat}' for key in PARAMETER_KEYS for stat in ('current', 'mean_30', 'std_30', 'min_30', 'max_30', 'slope_30')
]


def write_rows_to_postgres(rows) -> None:
    columns = ['batch_id', 'scenario', 'split'] + FEATURE_COLUMNS + TARGET_COLUMNS + [WEIGHT_COLUMN]
    placeholders = ', '.join(['%s'] * len(columns))
    column_list = ', '.join(columns)

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('TRUNCATE TABLE synthetic_kpi_training_dataset_12param')
            # np.generic (numpy scalar types, e.g. the float64s rng.normal()/np.clip()
            # return, or the np.str_ rng_master.choice() returns for `scenario`) must
            # be cast to native Python types before hitting psycopg2 - NumPy 2.x
            # changed these scalars' repr (e.g. "np.float64(...)"), which breaks
            # psycopg2's adapters even though they're still subclasses of the native
            # type. .item() converts any numpy scalar to its native Python equivalent.
            batch_values = [
                tuple(row[col].item() if isinstance(row[col], np.generic) else row[col] for col in columns)
                for row in rows
            ]
            cur.executemany(f'INSERT INTO synthetic_kpi_training_dataset_12param ({column_list}) VALUES ({placeholders})', batch_values)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def generate():
    rng_master = np.random.RandomState(42)
    rows = []
    scenario_names = [s[0] for s in SCENARIOS]
    scenario_params = dict(SCENARIOS)

    for batch_idx in range(N_BATCHES):
        rng = np.random.RandomState(1000 + batch_idx)
        scenario = rng_master.choice(scenario_names, p=SCENARIO_WEIGHTS)
        drifting_params = scenario_params[scenario]
        batch_id = f'SYN-{batch_idx:04d}'
        split = 'train' if batch_idx % 5 != 0 else 'test'  # 80/20 split by batch, not by row

        directions = {key: (1 if rng.rand() < 0.5 else -1) for key in PARAMETER_KEYS}
        severity_mult = 0.0
        severity_tier = None
        if drifting_params:
            severity_tier = rng.choice(list(SEVERITY_TIER_RANGES.keys()), p=SEVERITY_WEIGHTS)
            severity_lo, severity_hi = SEVERITY_TIER_RANGES[severity_tier]
            severity_mult = float(rng.uniform(severity_lo, severity_hi))

        duration_extension = round(DURATION_EXTENSION_PER_SEVERITY_UNIT * severity_mult)
        series, baseline_series, duration, onset = simulate_parameter_series(
            rng, drifting_params, severity_mult, directions, duration_extension,
        )

        # ONE final-outcome calculation per batch - not per row. Every row
        # generated below (at any elapsed minute) shares this same target.
        deviation_scores = final_deviation_scores(series, baseline_series, onset, duration)
        final_kpis = compute_final_kpis(rng, deviation_scores, duration, severity_tier)

        # The earliest point ANY of this batch's actual drifting parameters
        # could start showing a real signal - rows sampled before this are
        # genuinely unpredictable (see AMBIGUOUS_ROW_WEIGHT above). None for
        # Normal batches, since there's no onset to wait for.
        batch_onset_minute = min((onset[key] for key in drifting_params), default=None) if drifting_params else None

        # Input window is the RAW parameter values (matching
        # compute_live_feature_row exactly - the model's feature contract
        # must be identical to what live inference produces from real
        # telemetry). No reserved "future window" anymore - rows extend all
        # the way to the end of the batch.
        for t in range(LOOKBACK_MINUTES, duration + 1):
            window_now = {key: series[key][t - LOOKBACK_MINUTES:t + 1] for key in PARAMETER_KEYS}
            feature_row = build_feature_row(t, window_now)
            row_weight = _row_weight(t, batch_onset_minute, duration)
            rows.append({
                'batch_id': batch_id,
                'scenario': scenario,
                'split': split,
                **feature_row,
                **final_kpis,
                WEIGHT_COLUMN: row_weight,
            })

    write_rows_to_postgres(rows)
    print(f'Wrote {len(rows)} rows across {N_BATCHES} synthetic batches -> synthetic_kpi_training_dataset_12param')


if __name__ == '__main__':
    generate()
