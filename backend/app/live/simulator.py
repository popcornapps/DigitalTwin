"""Per-batch live physics simulator - a Python port of the phase-timeline and
baseline-curve logic in scripts/generate-dataset/phases.ts and baseline.ts,
extended with a 3-tier (Normal/Warning/Critical) drift profile in place of the
historical generator's full 17-scenario fault catalog (see the running-batch
design doc for that scoping decision). Emits one reading at a time, driven by
the scheduler, rather than computing a whole trajectory upfront.
"""
import math
import random
from datetime import datetime, timezone

from app.live import config
from app.live.models import TelemetryReading


def _lerp(t: float, t0: float, t1: float, v0: float, v1: float) -> float:
    if t <= t0:
        return v0
    if t >= t1:
        return v1
    return v0 + (v1 - v0) * ((t - t0) / (t1 - t0))


class BatchSimulator:
    def __init__(self, running_batch_id: str, scenario_profile: str, drifting_parameter: str | None):
        self.running_batch_id = running_batch_id
        self.scenario_profile = scenario_profile
        self.drifting_parameter = drifting_parameter
        # Seeded per-instance RNG - deterministic for a given batch id, but
        # (unlike the historical dataset) there's no requirement for this to
        # be reproducible across process restarts, since live batches are
        # ephemeral simulation, not versioned training data.
        self._rng = random.Random(hash(running_batch_id) & 0xFFFFFFFF)
        self._boundaries = self._build_phase_boundaries()
        self._drift_direction = {key: self._rng.choice([-1, 1]) for key in config.PARAMETER_KEYS}
        self._noise_state = {key: 0.0 for key in config.PARAMETER_KEYS}

    def _build_phase_boundaries(self) -> dict[str, float]:
        def jitter(minutes: int) -> float:
            return round(minutes * self._rng.uniform(0.9, 1.1))

        dispensing = jitter(config.NOMINAL_PHASE_DURATIONS['dispensing'])
        dry_mixing = jitter(config.NOMINAL_PHASE_DURATIONS['dry_mixing'])
        wet_massing = jitter(config.NOMINAL_PHASE_DURATIONS['wet_massing'])
        transfer = jitter(config.NOMINAL_PHASE_DURATIONS['transfer'])
        drying = jitter(config.NOMINAL_PHASE_DURATIONS['drying'])
        cooling = jitter(config.NOMINAL_PHASE_DURATIONS['cooling'])

        dispensing_end = dispensing
        dry_mixing_end = dispensing_end + dry_mixing
        wet_massing_end = dry_mixing_end + wet_massing
        transfer_end = wet_massing_end + transfer
        drying_end = transfer_end + drying
        cooling_end = drying_end + cooling
        return {
            'dispensing_end': dispensing_end,
            'dry_mixing_end': dry_mixing_end,
            'wet_massing_end': wet_massing_end,
            'transfer_end': transfer_end,
            'drying_end': drying_end,
            'cooling_end': cooling_end,
        }

    def target_duration_minutes(self) -> int:
        extension = config.CRITICAL_DURATION_EXTENSION_MINUTES if self.scenario_profile == 'Critical' else 0
        return int(self._boundaries['cooling_end'] + extension)

    def phase_at(self, t: float) -> str:
        b = self._boundaries
        if t < b['dispensing_end']:
            return 'dispensing'
        if t < b['dry_mixing_end']:
            return 'dry_mixing'
        if t < b['wet_massing_end']:
            return 'wet_massing'
        if t < b['transfer_end']:
            return 'transfer'
        if t < b['drying_end']:
            return 'drying'
        if t < b['cooling_end']:
            return 'cooling'
        return 'complete'

    # --- Baseline curves - ported from baseline.ts, one function per parameter ---

    def _agitator_rpm_baseline(self, t: float) -> float:
        b = self._boundaries
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

    def _flow_rate_baseline(self, t: float) -> float:
        b = self._boundaries
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

    def _process_pressure_baseline(self, t: float) -> float:
        b = self._boundaries
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

    def _temperature_baseline(self, t: float, current_rpm: float) -> float:
        b = self._boundaries
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

    # --- Noise + drift, applied on top of the baseline ---

    def _noise_step(self, key: str) -> float:
        pull = -config.NOISE_REVERSION_RATE * self._noise_state[key]
        shock = self._rng.gauss(0, config.NOISE_STD[key])
        self._noise_state[key] += pull + shock
        return self._noise_state[key]

    def _drift_offset(self, key: str, t: float) -> float:
        if self.scenario_profile == 'Normal' or key != self.drifting_parameter:
            return 0.0
        b = self._boundaries
        # Agitator RPM's only meaningful window is wet massing/transfer;
        # the other 3 only become meaningful once drying starts - matches
        # the same phase-scoping already established for the historical/ML
        # pipeline (Agitator RPM excluded from drying-window analyses there).
        onset = b['dispensing_end'] if key == 'agitator_rpm' else b['transfer_end']
        if t < onset:
            return 0.0
        param_cfg = config.get_parameter_config()[key]
        band_width = param_cfg['upper_limit'] - param_cfg['lower_limit']
        rate = config.DRIFT_RATE_PER_MINUTE_FRACTION_OF_BAND[self.scenario_profile]
        return self._drift_direction[key] * rate * band_width * (t - onset)

    def reading_at(self, t: float) -> TelemetryReading:
        agitator_rpm = max(0.0, self._agitator_rpm_baseline(t) + self._noise_step('agitator_rpm') + self._drift_offset('agitator_rpm', t))
        flow_rate = max(0.0, self._flow_rate_baseline(t) + self._noise_step('flow_rate') + self._drift_offset('flow_rate', t))
        process_pressure = max(0.0, self._process_pressure_baseline(t) + self._noise_step('process_pressure') + self._drift_offset('process_pressure', t))
        temperature = self._temperature_baseline(t, agitator_rpm) + self._noise_step('temperature') + self._drift_offset('temperature', t)

        return TelemetryReading(
            running_batch_id=self.running_batch_id,
            elapsed_minutes=int(t),
            recorded_at=datetime.now(timezone.utc),
            phase=self.phase_at(t),
            temperature=round(temperature, 2),
            process_pressure=round(process_pressure, 3),
            flow_rate=round(flow_rate, 2),
            agitator_rpm=round(agitator_rpm, 1),
        )
