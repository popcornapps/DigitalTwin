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


# --- The 8 new parameters (see scripts/generate-support-parameters/) -
# same correlation design as that historical generator, adapted to per-tick
# live simulation. Unlike that script, this class already knows its own
# exact phase boundaries at construction time (self._boundaries), so there's
# no duration-based reconstruction uncertainty to work around here. ---

SEVERITY_MULTIPLIER = {'Normal': 0.0, 'Warning': 0.5, 'Critical': 1.0}
BURST_INTERVAL_MINUTES = 45.0
BURST_DURATION_MINUTES = 12.0


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
        self._shaker_burst_offset = self._rng.uniform(0, BURST_INTERVAL_MINUTES)

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

    # --- The 8 new parameters' baseline curves - correlated with the
    # original 4 exactly like generate_support_parameters.py, just computed
    # live from this tick's own values instead of a whole finished batch. ---

    def _gap_at(self, t: float, pre_drying_gap: float, gap_start_val: float, gap_end_val: float) -> float:
        """Same smooth gap-ramp as generate_support_parameters.py's fixed
        gap_at (small pre-drying, ramping up at drying start, narrowing by
        drying end) - reused here, not reimplemented from scratch."""
        transfer_end, drying_end = self._boundaries['transfer_end'], self._boundaries['drying_end']
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

    def _exhaust_air_temp_baseline(self, t: float, temperature: float) -> float:
        return temperature - self._gap_at(t, 3.0, 25.0, 8.0)

    def _product_bed_temp_baseline(self, t: float, temperature: float) -> float:
        return temperature - self._gap_at(t, 4.0, 27.0, 5.0)

    def _filter_dp_baseline(self, t: float) -> float:
        duration = self.target_duration_minutes()
        frac = t / duration if duration else 0.0
        severity_mult = SEVERITY_MULTIPLIER[self.scenario_profile]
        extra = severity_mult * (6.0 if self.drifting_parameter == 'flow_rate' else 5.0 if self.drifting_parameter == 'process_pressure' else 0.0)
        return 3.0 + (20.0 - 3.0) * frac + extra * frac

    def _chamber_dp_baseline(self, t: float, flow_rate: float) -> float:
        severity_mult = SEVERITY_MULTIPLIER[self.scenario_profile]
        extra = severity_mult * 4.0 if self.drifting_parameter == 'process_pressure' else 0.0
        duration = self.target_duration_minutes()
        frac = t / duration if duration else 0.0
        return 0.30 * flow_rate + 0.01 * t + extra * frac

    def _damper_baseline(self, filter_dp: float) -> float:
        return 50.0 + 1.2 * (filter_dp - 3.0)

    def _shaker_and_compressed_air_at(self, t: float) -> tuple[float, float]:
        phase_pos = (t + self._shaker_burst_offset) % BURST_INTERVAL_MINUTES
        in_burst = phase_pos < BURST_DURATION_MINUTES
        if in_burst:
            bump_frac = 1.0 - abs((phase_pos / BURST_DURATION_MINUTES) - 0.5) * 2
            shaker_base = 2.0 + 6.0 * bump_frac
        else:
            shaker_base = 0.3
        shaker = max(0.0, shaker_base + self._rng.gauss(0, 0.4))
        dip = 0.8 if in_burst else 0.0
        compressed_air = max(4.0, min(7.5, 6.0 - dip + self._rng.gauss(0, 0.12)))
        return shaker, compressed_air

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

        # The 8 new parameters - Exhaust/Bed Temp and Chamber DP are derived
        # from this tick's OWN temperature/flow_rate (above), so they inherit
        # any live drift/noise in those for free whenever one of the
        # original 4 is the chosen fault source, same design as the
        # historical generator. Each also gets its own `_drift_offset` call
        # so any of the 8 can ALSO be picked directly as the fault source
        # (it's a no-op unless `self.drifting_parameter` is that exact key).
        inlet_air_humidity = min(35.0, max(10.0, 20.0 + self._noise_step('inlet_air_humidity') + self._drift_offset('inlet_air_humidity', t)))
        exhaust_air_temp = min(70.0, max(20.0, self._exhaust_air_temp_baseline(t, temperature) + self._noise_step('exhaust_air_temp') + self._drift_offset('exhaust_air_temp', t)))
        product_bed_temp = min(70.0, max(20.0, self._product_bed_temp_baseline(t, temperature) + self._noise_step('product_bed_temp') + self._drift_offset('product_bed_temp', t)))
        filter_differential_pressure = min(40.0, max(1.0, self._filter_dp_baseline(t) + self._noise_step('filter_differential_pressure') + self._drift_offset('filter_differential_pressure', t)))
        chamber_differential_pressure = min(45.0, max(0.0, self._chamber_dp_baseline(t, flow_rate) + self._noise_step('chamber_differential_pressure') + self._drift_offset('chamber_differential_pressure', t)))
        ahu_damper_position = min(100.0, max(0.0, self._damper_baseline(filter_differential_pressure) + self._noise_step('ahu_damper_position') + self._drift_offset('ahu_damper_position', t)))
        shaker_vibration_frequency, compressed_air_pressure = self._shaker_and_compressed_air_at(t)
        shaker_vibration_frequency = max(0.0, shaker_vibration_frequency + self._drift_offset('shaker_vibration_frequency', t))
        compressed_air_pressure = min(7.5, max(4.0, compressed_air_pressure + self._drift_offset('compressed_air_pressure', t)))

        return TelemetryReading(
            running_batch_id=self.running_batch_id,
            elapsed_minutes=int(t),
            recorded_at=datetime.now(timezone.utc),
            phase=self.phase_at(t),
            temperature=round(temperature, 2),
            process_pressure=round(process_pressure, 3),
            flow_rate=round(flow_rate, 2),
            agitator_rpm=round(agitator_rpm, 1),
            inlet_air_humidity=round(inlet_air_humidity, 2),
            exhaust_air_temp=round(exhaust_air_temp, 2),
            filter_differential_pressure=round(filter_differential_pressure, 2),
            shaker_vibration_frequency=round(shaker_vibration_frequency, 2),
            product_bed_temp=round(product_bed_temp, 2),
            chamber_differential_pressure=round(chamber_differential_pressure, 2),
            ahu_damper_position=round(ahu_damper_position, 2),
            compressed_air_pressure=round(compressed_air_pressure, 2),
        )
