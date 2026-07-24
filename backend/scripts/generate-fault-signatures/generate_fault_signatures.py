"""Generates data/paracetamol_fault_signatures.json - an empirically-derived
lookup table of "which parameter(s) does each historical fault scenario
actually move, and in which direction", used by the Process Parameter
Deviation Agent's Explain/Recommend capabilities.

This is a signature LOOKUP, not trajectory pattern-matching (a heavier
version deferred per the agreed POC scope) - deliberately simple and
honestly grounded in real historical batches, not invented text. Only the
`recommended_action` string per scenario is curated/hand-written (a
maintenance action directly implied by the scenario's own name); everything
else (which parameters, which direction, how many batches support it) is
computed from the real generated dataset.

Method:
1. For each non-Normal batch, compute its mean deviation from the golden
   batch, per parameter, over that scenario's own meaningful window - the
   drying window [150, duration-70] for Temperature/Process Pressure/Flow
   Rate (same window valid_time_range already uses), but the wet-massing +
   transfer window [45, 85] for Agitator RPM specifically, since RPM is
   correctly idle (zero variance) during drying - checking it there would
   show no signature at all, not because nothing happened, but because
   that's not when Agitator RPM is active.
2. A parameter counts as part of a scenario's "signature" only if its
   deviation sign is consistent across every batch with that scenario AND
   the average magnitude exceeds 5% of that parameter's golden band width -
   filtering out noise from small-sample, weak-effect scenarios rather than
   overclaiming a signature that isn't really there.
"""
import json
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / 'data'

BATCHES_CSV = DATA_DIR / 'paracetamol_batches.csv'
TIMESERIES_CSV = DATA_DIR / 'paracetamol_batch_timeseries.csv'
PARAMETER_CONFIG_CSV = DATA_DIR / 'paracetamol_parameter_config.csv'
OUT_JSON = DATA_DIR / 'paracetamol_fault_signatures.json'

DRYING_PARAMS = ['temperature', 'process_pressure', 'flow_rate']
DRYING_WINDOW = (150, None)  # upper bound is duration - 70, computed per batch
AGITATOR_WINDOW = (45, 85)   # wet massing + transfer, nominal

NOISE_FLOOR_FRACTION = 0.05  # of the parameter's golden band width

# Which parameter(s) a scenario's own name/category implies - used as the
# CANDIDATE set to check for a real signature against, rather than letting
# pure statistics pick an unrelated parameter by chance. With several
# scenarios having only 1-2 supporting batches, a narrow-banded parameter
# (Agitator RPM's band is only 4 RPM wide) can cross the noise floor by pure
# chance - restricting candidates to what the scenario category actually
# claims keeps the signature honest (e.g. a Pressure_* scenario is only ever
# checked against process_pressure, never spuriously against agitator_rpm).
SCENARIO_PREFIX_TO_PARAM = {
    'Temperature': 'temperature',
    'Pressure': 'process_pressure',
    'FlowRate': 'flow_rate',
    'Agitator': 'agitator_rpm',
}
CORRELATED_CANDIDATES = {
    'Correlated_DryerRestriction': ['process_pressure', 'flow_rate'],
}

PARAM_CONFIG_NAMES = {
    'temperature': 'Temperature',
    'process_pressure': 'Process Pressure',
    'flow_rate': 'Flow Rate',
    'agitator_rpm': 'Agitator RPM',
}

RECOMMENDED_ACTIONS = {
    'Temperature_HeaterFault': 'Inspect and calibrate the drying heater element; check for a stuck or miscalibrated heating control loop.',
    'Temperature_HeatExchangerFouling': 'Inspect and clean the heat exchanger; fouling is reducing heat transfer efficiency.',
    'Temperature_SensorDrift': 'Verify temperature sensor calibration against a reference probe.',
    'Temperature_PidHunting': 'Review PID tuning parameters for the temperature control loop; oscillation suggests unstable tuning.',
    'Pressure_DamperSticking': 'Inspect the pressure control damper for mechanical sticking; free up or replace the actuator.',
    'Pressure_FilterLoading': 'Check and replace the process filter; loading is restricting normal pressure regulation.',
    'Pressure_SealLeak': 'Inspect seals on the pressure vessel/ductwork for leaks.',
    'Pressure_BlowerFluctuation': 'Check the blower motor and drive for speed fluctuation or bearing wear.',
    'FlowRate_FanFault': 'Inspect the drying air fan for fault or blade damage.',
    'FlowRate_FilterLoadingDecay': 'Replace or clean the air filter; progressive loading is restricting flow.',
    'FlowRate_DamperMiscalibration': 'Recalibrate the flow control damper position.',
    'FlowRate_DuctBlockage': 'Inspect ductwork for blockage or obstruction restricting airflow.',
    'Agitator_VfdLock': 'Check the agitator VFD (variable frequency drive) for a fault or lockout condition.',
    'Agitator_LoadCreep': 'Inspect agitator load/torque; gradual creep suggests material buildup or bearing drag.',
    'Agitator_OverloadTrip': 'Check agitator motor overload protection and investigate the cause of excess load.',
    'Agitator_BearingWear': 'Inspect agitator bearings for wear; schedule preventive maintenance.',
    'Correlated_DryerRestriction': 'Inspect the dryer air path for restriction - a blockage simultaneously raises pressure and reduces flow.',
}


def main():
    batches = pd.read_csv(BATCHES_CSV)
    ts = pd.read_csv(TIMESERIES_CSV)
    param_config = pd.read_csv(PARAMETER_CONFIG_CSV).set_index('parameter')
    golden = ts[ts['batch_id'] == 'PAR-GOLDEN'].set_index('elapsed_minutes')

    band_width = {
        key: param_config.loc[name, 'upper_limit'] - param_config.loc[name, 'lower_limit']
        for key, name in PARAM_CONFIG_NAMES.items()
    }

    fault_batches = batches[batches['deviation_severity'].notna()].copy()
    scenarios = sorted(fault_batches['deviation_scenario'].unique())

    signatures = {}
    for scenario in scenarios:
        sub = fault_batches[fault_batches['deviation_scenario'] == scenario]
        is_agitator = scenario.startswith('Agitator')

        per_param_devs = {p: [] for p in ['temperature', 'process_pressure', 'flow_rate', 'agitator_rpm']}
        for _, row in sub.iterrows():
            bid = row['batch_id']
            duration = int(row['batch_duration_minutes'])
            b = ts[ts['batch_id'] == bid].set_index('elapsed_minutes')
            common_t = b.index.intersection(golden.index)

            drying_t = [t for t in common_t if DRYING_WINDOW[0] <= t <= duration - 70]
            agitator_t = [t for t in common_t if AGITATOR_WINDOW[0] <= t <= AGITATOR_WINDOW[1]]

            for p in DRYING_PARAMS:
                if drying_t:
                    per_param_devs[p].append(float((b.loc[drying_t, p] - golden.loc[drying_t, p]).mean()))
            if agitator_t:
                per_param_devs['agitator_rpm'].append(float((b.loc[agitator_t, 'agitator_rpm'] - golden.loc[agitator_t, 'agitator_rpm']).mean()))

        candidate_params = CORRELATED_CANDIDATES.get(scenario)
        if candidate_params is None:
            prefix = scenario.split('_')[0]
            candidate_params = [SCENARIO_PREFIX_TO_PARAM[prefix]]

        signature = {}
        primary_parameters = []
        for p, devs in per_param_devs.items():
            if not devs:
                continue
            mean_dev = sum(devs) / len(devs)
            signs = [d > 0 for d in devs]
            consistent_sign = all(signs) or not any(signs)
            noise_floor = band_width[p] * NOISE_FLOOR_FRACTION
            is_signature = p in candidate_params and consistent_sign and abs(mean_dev) > noise_floor
            signature[p] = {
                'mean_deviation': round(mean_dev, 3),
                'direction': 'up' if mean_dev > 0 else 'down',
                'consistent': bool(consistent_sign),
                'is_signature_parameter': bool(is_signature),
            }
            if is_signature:
                primary_parameters.append(p)

        signatures[scenario] = {
            'batch_count': len(sub),
            'severities_seen': sorted(sub['deviation_severity'].unique().tolist()),
            'primary_parameters': primary_parameters,
            'signature': signature,
            'recommended_action': RECOMMENDED_ACTIONS.get(scenario, 'Investigate the affected parameter and cross-reference with maintenance logs.'),
        }
        print(f"{scenario}: primary={primary_parameters} (n={len(sub)})")

    OUT_JSON.write_text(json.dumps(signatures, indent=2))
    print(f'\nWrote {len(signatures)} fault signatures to {OUT_JSON}')


if __name__ == '__main__':
    main()
