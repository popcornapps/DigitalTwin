"""Constants for the live-batch simulator. Deliberately self-contained (no
import from app.config / app.state) so the live subsystem stays fully
decoupled from the historical/ML plane, per the running-batch design doc.

Physical constants below are a Python port of
scripts/generate-dataset/config.ts - kept in sync by hand since that file is
the historical generator's own source of truth and isn't imported here.
"""
import os

PLANTS = ['Hyderabad Plant']

PARAMETER_KEYS = ('temperature', 'process_pressure', 'flow_rate', 'agitator_rpm')

# Ported from scripts/generate-dataset/config.ts's PARAMETER_CONFIG.
PARAMETER_CONFIG = {
    'temperature': {'unit': '°C', 'golden_target': 65.5, 'lower_limit': 63.0, 'upper_limit': 67.0},
    'process_pressure': {'unit': 'bar', 'golden_target': 1.2, 'lower_limit': 1.1, 'upper_limit': 1.3},
    'flow_rate': {'unit': 'L/min', 'golden_target': 48.5, 'lower_limit': 45.0, 'upper_limit': 52.0},
    'agitator_rpm': {'unit': 'RPM', 'golden_target': 22.0, 'lower_limit': 20.0, 'upper_limit': 24.0},
}

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
# without a code change (e.g. `LIVE_BATCH_SPEED_PROFILE=accelerated uvicorn
# ...`) - defaults to 'demo' per the current product decision.
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
NOISE_STD = {
    'temperature': 0.3,
    'process_pressure': 0.01,
    'flow_rate': 0.4,
    'agitator_rpm': 0.5,
}

# Mean-reversion pull rate applied to the noise walk's own accumulated offset
# each tick (in 1-sim-minute step units) - keeps noise bounded without drift.
NOISE_REVERSION_RATE = 0.15

# Default seed batches created once at backend startup - all at the single
# supported plant (see PLANTS above); the three scenario profiles still vary.
DEFAULT_SEED_BATCHES = [
    {'plant': 'Hyderabad Plant', 'scenario_profile': 'Normal', 'drifting_parameter': None},
    {'plant': 'Hyderabad Plant', 'scenario_profile': 'Warning', 'drifting_parameter': None},
    {'plant': 'Hyderabad Plant', 'scenario_profile': 'Critical', 'drifting_parameter': None},
]
