"""Constants for the live-batch simulator. Deliberately self-contained (no
import from app.config / app.state) so the live subsystem stays fully
decoupled from the historical/ML plane, per the running-batch design doc.
get_parameter_config() below is the one exception to "no cross-plane
values": it reads the `parameters` Postgres table - the same physical table
app_state.parameter_limits reads - via app.db (a generic connection helper,
not historical/ML business logic, so this doesn't reintroduce the coupling
the decoupling rule is actually about). It keeps its own local
_PARAMETER_TABLE_NAMES mapping rather than importing
app.config.PARAMETER_CONFIG_NAMES, so this module still never imports
app.config itself.

Physical constants below are a Python port of
scripts/generate-dataset/config.ts - kept in sync by hand since that file is
the historical generator's own source of truth and isn't imported here.
"""
import os
from datetime import timedelta

from app.db import get_connection

PLANTS = ['Hyderabad Plant']

PARAMETER_KEYS = (
    'temperature', 'process_pressure', 'flow_rate', 'agitator_rpm',
    'inlet_air_humidity', 'exhaust_air_temp', 'filter_differential_pressure',
    'shaker_vibration_frequency', 'product_bed_temp', 'chamber_differential_pressure',
    'ahu_damper_position', 'compressed_air_pressure',
)

# Maps this module's internal snake_case keys to the `parameters` table's
# display-name primary key - a local duplicate of app.config's
# PARAMETER_CONFIG_NAMES, kept separate rather than imported (see module
# docstring for why).
_PARAMETER_TABLE_NAMES = {
    'temperature': 'Temperature',
    'process_pressure': 'Process Pressure',
    'flow_rate': 'Flow Rate',
    'agitator_rpm': 'Agitator RPM',
    'inlet_air_humidity': 'Inlet Air Humidity',
    'exhaust_air_temp': 'Exhaust Air Temperature',
    'filter_differential_pressure': 'Filter Differential Pressure',
    'shaker_vibration_frequency': 'Shaker Vibration Frequency',
    'product_bed_temp': 'Product Bed Temperature',
    'chamber_differential_pressure': 'Chamber Differential Pressure',
    'ahu_damper_position': 'AHU Damper Position',
    'compressed_air_pressure': 'Compressed Air Pressure',
}

_parameter_config_cache: dict | None = None


def get_parameter_config() -> dict:
    """Same shape as the old hardcoded PARAMETER_CONFIG dict this replaces
    (see scripts/postgres-migration/) - loaded once and cached, not queried
    per call, since this is read on every simulator tick for every running
    batch (see simulator.py's _drift_offset) and a per-tick DB round trip
    there would be wasteful."""
    global _parameter_config_cache
    if _parameter_config_cache is None:
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute(
                'SELECT parameter, unit, golden_target, lower_limit, upper_limit '
                'FROM parameters WHERE parameter = ANY(%s)',
                (list(_PARAMETER_TABLE_NAMES.values()),),
            )
            rows_by_name = {name: (unit, target, lower, upper) for name, unit, target, lower, upper in cur.fetchall()}
        _parameter_config_cache = {
            key: {
                'unit': rows_by_name[name][0],
                'golden_target': rows_by_name[name][1],
                'lower_limit': rows_by_name[name][2],
                'upper_limit': rows_by_name[name][3],
            }
            for key, name in _PARAMETER_TABLE_NAMES.items()
        }
    return _parameter_config_cache

# Ported from scripts/generate-dataset/config.ts's NOMINAL_PHASE_DURATIONS.
NOMINAL_PHASE_DURATIONS = {
    'dispensing': 25,
    'dry_mixing': 20,
    'wet_massing': 25,
    'transfer': 15,
    'drying': 270,
    'cooling': 30,
}

# Named progression-speed presets - real seconds of wall-clock time per
# simulated minute. 'demo' is slow enough that a trend takes real, watchable
# time to develop (a ~385-minute batch completes in ~39 real minutes) - meant
# for actually observing a batch and its future predictions play out, not for
# racing through one. 'accelerated' is the old fast pace, kept for quick
# smoke-tests where watching a batch finish in real time isn't the point.
SPEED_PROFILES = {
    'demo': 6.0,
    'accelerated': 2.0,
}

# Selected via the LIVE_BATCH_SPEED_PROFILE env var so this can be switched
# without a code change - defaults to 'demo' (6 sec/sim-minute). Run
# `LIVE_BATCH_SPEED_PROFILE=accelerated uvicorn ...` (2 sec/sim-minute,
# batches finish in ~13 real minutes instead of ~39) whenever faster
# testing is actually wanted, instead of changing this default back and forth.
ACTIVE_SPEED_PROFILE = os.environ.get('LIVE_BATCH_SPEED_PROFILE', 'demo')
if ACTIVE_SPEED_PROFILE not in SPEED_PROFILES:
    raise ValueError(
        f"Unknown LIVE_BATCH_SPEED_PROFILE '{ACTIVE_SPEED_PROFILE}' - must be one of {list(SPEED_PROFILES)}"
    )

TICK_INTERVAL_SECONDS = SPEED_PROFILES[ACTIVE_SPEED_PROFILE]
SIMULATED_MINUTES_PER_TICK = 1

# Per-tier live-simulation drift, expressed as a fraction of a parameter's
# band width (upper_limit - lower_limit) added per minute once drift onset
# begins. This is a deliberately simpler 3-tier model than the historical
# generator's 17-scenario fault catalog (see the design doc) - Normal has no
# drift_rate entry (noise only).
DRIFT_RATE_PER_MINUTE_FRACTION_OF_BAND = {
    'Warning': 0.0025,
    'Critical': 0.006,
}

# A Critical drift stalling drying legitimately extends the batch, mirroring
# how historical Critical/correlated-fault batches also run long.
CRITICAL_DURATION_EXTENSION_MINUTES = 80

# Which parameter drifts when a Warning/Critical batch doesn't specify one -
# Temperature is the parameter demonstrated everywhere else in this platform.
DEFAULT_DRIFTING_PARAMETER = 'temperature'

# Per-parameter noise standard deviation for the live mean-reverting walk -
# a simplified, visually-reasonable calibration, not bit-matched to the
# historical generator's own noise tuning (that one isn't imported here).
# Shaker Vibration Frequency and Compressed Air Pressure aren't listed here -
# they follow their own burst-cycle noise in simulator.py, not this generic
# mean-reverting walk (see generate_support_parameters.py, which uses the
# same distinction).
NOISE_STD = {
    'temperature': 0.3,
    'process_pressure': 0.01,
    'flow_rate': 0.4,
    'agitator_rpm': 0.5,
    'inlet_air_humidity': 1.5,
    'exhaust_air_temp': 0.5,
    'filter_differential_pressure': 0.8,
    'product_bed_temp': 0.6,
    'chamber_differential_pressure': 0.6,
    'ahu_damper_position': 1.5,
}

# Mean-reversion pull rate applied to the noise walk's own accumulated offset
# each tick (in 1-sim-minute step units) - keeps noise bounded without drift.
NOISE_REVERSION_RATE = 0.15

# Daily cap on how many batches can be created per plant - counts EVERY
# status (Running + Completed + Stopped), not just currently-active ones, so
# creating and immediately stopping a batch still consumes a slot (each
# created batch already used real materials/equipment time, regardless of
# whether it was later aborted early). Resets with the in-memory registry
# (i.e. on process restart), same caveat as the rest of this ephemeral
# subsystem - see registry.py's own docstring.
MAX_BATCHES_PER_PLANT_PER_DAY = 20

# Default seed batches created once at backend startup - all at the single
# supported plant (see PLANTS above). Each one names its own drifting_parameter
# explicitly (rather than leaving it None, which would fall back to
# DEFAULT_DRIFTING_PARAMETER='temperature' for every one of them) so a fresh
# restart demonstrates deviations spread across both the original 4 and the
# 8 added in Step 1 - a mix of cascading (Temperature/Flow Rate, which also
# visibly drift their correlated new parameters) and isolated (Filter DP,
# Shaker) examples, and both "has a historical root-cause match" (the
# original 2) and "novel/unclassified deviation" (the new 2) LLM-reasoning
# paths.
DEFAULT_SEED_BATCHES = [
    {'plant': 'Hyderabad Plant', 'scenario_profile': 'Critical', 'drifting_parameter': 'temperature'},
    {'plant': 'Hyderabad Plant', 'scenario_profile': 'Warning', 'drifting_parameter': 'flow_rate'},
    {'plant': 'Hyderabad Plant', 'scenario_profile': 'Critical', 'drifting_parameter': 'filter_differential_pressure'},
    {'plant': 'Hyderabad Plant', 'scenario_profile': 'Warning', 'drifting_parameter': 'shaker_vibration_frequency'},
]

# --- Continuous demo mode - see the running-batch design doc's "always-on
# demo" revision. All 4 settings below only affect the automatic-replenish
# path (app.live.service.create_random_demo_batch / prune_old_demo_batches,
# invoked from scheduler.py) - manual batch creation via the API is
# unaffected. ---

# How many minutes of history a NEW batch gets instantly, at creation time,
# instead of waiting on real ticks - matches app.config.LOOKBACK_MINUTES (30)
# so a full feature window exists from the very first read. Ported, not
# imported (registry.py stays decoupled from app.config - see its own
# docstring), kept in sync by hand like every other cross-plane constant.
PREFILL_MINUTES = 30

# When True, the scheduler creates one replacement batch (drawn from
# DEMO_SCENARIO_POOL below) the instant a batch naturally Completes, so the
# demo runs unattended forever without anyone needing to click "create
# batch." Toggle off (e.g. for automated testing) without a code change.
AUTO_REPLENISH_BATCHES = True

# How many finished (Completed OR Stopped) demo batches to keep fully
# available - in memory (telemetry, latest prediction/assessments) and in
# Postgres (alerts, batches/batch_kpis) - for "recently finished" inspection
# in the UI. The moment an older one ages out past this count, everything
# about it is deleted (app.live.service.prune_old_demo_batches) - keeps both
# memory and Postgres bounded no matter how long the demo runs. Applies
# equally to naturally-Completed and manually-Stopped batches (sorted by
# RunningBatch.terminal_at), not just one or the other.
DEMO_BATCH_RETENTION_COUNT = 10

# Matches history_writer.GENERATION_METHOD_VERSION exactly - the tag written
# to batch_kpis.generation_method_version for every live-completed batch.
# Used by app.services.data_service to EXCLUDE continuously-cycling demo
# batches from the Plant KPI rollup/period aggregates, so those numbers keep
# reflecting only the real historical dataset (+ anything manually created)
# and are never affected by auto-replenishment or by prune_old_demo_batches
# deleting an old demo batch's row later. Ported, not imported (same
# cross-module constant-duplication convention used everywhere else here).
DEMO_BATCH_GENERATION_TAG = 'live_completion_v2'

# Weighted pool the scheduler draws from when auto-replenishing - covers
# Normal plus both severities of all 8 causal parameters (the original 4 +
# the 4 added by the 12-parameter causal-formula revision), so a long-running
# unattended demo actually exercises the full range of KPI Prediction/
# Process Monitoring behavior instead of only ever showing DEFAULT_SEED_
# BATCHES' fixed 4 scenarios. Normal weighted higher than any single fault,
# roughly matching the ~25% Normal proportion scripts/generate-synthetic-kpi-
# data/generate_synthetic_kpi_data.py's SCENARIO_WEIGHTS already uses.
# How long an alert (Open or Resolved, any batch, temporary or permanent)
# stays in Postgres before app.live.service.purge_old_alerts deletes it -
# independent of DEMO_BATCH_RETENTION_COUNT above (that's a per-batch,
# count-based policy; this is a global, time-based one, applying even to a
# still-Running batch's own alerts). Alerts/recommendations/AI explanations
# all live in the same `alerts` row (see app.live.models.DeviationAlert), so
# one delete covers all three.
ALERT_RETENTION = timedelta(hours=24)

DEMO_SCENARIO_POOL = [
    {'scenario_profile': 'Normal', 'drifting_parameter': None, 'weight': 5},
] + [
    {'scenario_profile': severity, 'drifting_parameter': param, 'weight': 1}
    for param in (
        'temperature', 'process_pressure', 'flow_rate', 'agitator_rpm',
        'filter_differential_pressure', 'shaker_vibration_frequency',
        'inlet_air_humidity', 'compressed_air_pressure',
    )
    for severity in ('Warning', 'Critical')
]
