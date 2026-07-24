"""The Process Parameter Deviation Agent - the second (and last) file in
app/live/ that imports from the historical/ML plane, alongside ml_bridge.py.

Detect, Project, and Alert are fully deterministic, grounded in real data
computed elsewhere in this codebase:

- Detect:  reuses the existing dynamic Golden(t)+/-Margin(t) envelope
           (paracetamol_golden_envelope.csv) for the CURRENT reading, and
           the existing trained model's alert_level for the PREDICTED one.
- Project: time-to-breach from {param}_slope_30, a feature already computed
           for the model on every tick - just surfaced here.
- Alert:   handled by alert_registry.py, fed by this module's output.

Explain/Recommend are the LLM reasoning layer (app.live.llm_agent, powered by
Azure OpenAI): this module's job is to assemble the EVIDENCE that reasoning
is grounded in - the ranked historical fault-signature candidates
(_rank_root_cause_candidates, still a deterministic score over real
historical batch data) plus the numeric current/predicted/confidence/
co-deviating-parameter facts - and hand it to alert_registry.sync_from_
assessment, which decides whether the LLM actually needs to be called this
tick (new alert / material state change) and calls app.live.llm_agent to
synthesize the assessment. This module never calls the LLM itself and never
picks a final root cause or action - it only prepares the evidence.

Current and Predicted are kept as two clearly separate assessments per
parameter throughout - a parameter can be fine now but forecast to breach
soon, or vice versa, and collapsing that into one status would hide it.
"""
import json

from app.config import FAULT_SIGNATURES_PATH, PARAMETER_LABELS, PARAMETER_UNITS
from app.live import config as live_config
from app.live.ml_bridge import compute_live_feature_row
from app.live.models import ParameterAssessment, RunningBatch
from app.live.service import get_latest_reading
from app.services.alert_service import classify_actual
from app.state import app_state

_FAULT_SIGNATURES: dict = json.loads(FAULT_SIGNATURES_PATH.read_text())

_golden_ts_cache = None


def _golden_timeseries():
    global _golden_ts_cache
    if _golden_ts_cache is None:
        _golden_ts_cache = app_state.timeseries_df[app_state.timeseries_df['batch_id'] == 'PAR-GOLDEN'].set_index('elapsed_minutes')
    return _golden_ts_cache


def _golden_value_at(key: str, elapsed_minutes: int) -> float:
    golden = _golden_timeseries()
    if elapsed_minutes in golden.index:
        return float(golden.loc[elapsed_minutes, key])
    clamped = min(max(elapsed_minutes, golden.index.min()), golden.index.max())
    return float(golden.loc[clamped, key])


def _envelope_offsets_at(key: str, elapsed_minutes: int) -> tuple[float, float]:
    envelope = app_state.golden_envelope_df
    clamped = min(max(elapsed_minutes, envelope.index.min()), envelope.index.max())
    row = envelope.loc[clamped]
    return float(row[f'{key}_lower_offset']), float(row[f'{key}_upper_offset'])


def _dynamic_band(key: str, elapsed_minutes: int) -> tuple[float, float, float]:
    """Returns (lower, upper, golden_value) - the same Golden(t)+/-Margin(t)
    band Process Monitoring's frontend already computes, replicated here so
    the agent's CURRENT-deviation judgment matches what the operator sees."""
    golden = _golden_value_at(key, elapsed_minutes)
    lower_offset, upper_offset = _envelope_offsets_at(key, elapsed_minutes)
    return golden + lower_offset, golden + upper_offset, golden


def _confidence_from_ci(ci_low: float, ci_high: float, lower: float, upper: float) -> str:
    band_width = upper - lower
    if band_width <= 0:
        return 'Low'
    ratio = (ci_high - ci_low) / band_width
    if ratio < 0.2:
        return 'High'
    if ratio < 0.5:
        return 'Medium'
    return 'Low'


def _time_to_breach(current: float, slope: float, lower: float, upper: float, max_minutes: float = 180) -> float | None:
    """Linear extrapolation from the same slope feature already computed for
    the model (`{param}_slope_30`) - reused, not recomputed. None if the
    parameter isn't trending toward either limit, or the estimate is too far
    out to be a meaningful linear extrapolation."""
    flat_threshold = (upper - lower) * 0.001
    if abs(slope) < flat_threshold:
        return None
    target = upper if slope > 0 else lower
    distance = target - current
    if (slope > 0 and distance <= 0) or (slope < 0 and distance >= 0):
        return 0.0
    minutes = distance / slope
    if minutes > max_minutes:
        return None
    return round(minutes, 1)


def _rank_root_cause_candidates(deviating: dict[str, str], target_key: str, top_n: int = 3) -> list[dict]:
    """deviating: {param_key: 'up'|'down'} for every parameter currently or
    predictedly out of band. target_key restricts candidates to scenarios
    that actually name target_key as one of their own primary parameters -
    without this, a scenario scoped only to Temperature (e.g.
    Temperature_HeaterFault) could rank as the "closest match" for an
    unrelated Agitator RPM deviation just because Temperature also happened
    to be deviating in the same tick. This is the same class of bug fixed
    earlier for the old signature-lookup, and applies here too even though
    ranking is otherwise just evidence-gathering for the LLM, not a final
    answer - the LLM is only given candidates that plausibly explain the
    parameter it's actually reasoning about.

    Returns up to top_n candidate historical fault signatures, ranked by
    score, each with full per-parameter match evidence. The LLM reasoning
    layer (llm_agent.py) is given this whole ranked list and reasons over
    which one(s) actually fit, including ruling candidates out using
    parameters that ISN'T deviating - it does not just take candidate #1."""
    scored = []
    for scenario, sig in _FAULT_SIGNATURES.items():
        primary = sig['primary_parameters']
        if not primary or target_key not in primary:
            continue
        match_evidence = []
        matches = 0
        for p in primary:
            expected_direction = sig['signature'].get(p, {}).get('direction')
            observed_direction = deviating.get(p)
            matched = observed_direction is not None and observed_direction == expected_direction
            if matched:
                matches += 1
            match_evidence.append({
                'parameter': PARAMETER_LABELS.get(p, p),
                'expected_direction': expected_direction,
                'observed_direction': observed_direction,
                'matched': matched,
            })
        if matches == 0:
            continue
        # Weight by how completely it matches AND how many real batches support this signature.
        match_fraction = matches / len(primary)
        score = match_fraction * sig['batch_count']
        scored.append({
            'scenario': scenario,
            'score': score,
            'batch_count': sig['batch_count'],
            'match_fraction': match_fraction,
            'parameter_evidence': match_evidence,
            'recommended_action': sig['recommended_action'],
        })
    scored.sort(key=lambda c: c['score'], reverse=True)
    return scored[:top_n]


def _observation(label: str, status: str, current: float, golden: float, unit: str) -> str:
    diff = current - golden
    sign = '+' if diff > 0 else ''
    if status == 'normal':
        return f'{label} is tracking close to the ideal profile ({sign}{diff:.2f} {unit} off).'
    if status == 'warning':
        return f'{label} is drifting from the ideal profile ({sign}{diff:.2f} {unit}) and is nearing the edge of the expected range.'
    return f'{label} has moved outside the expected range ({sign}{diff:.2f} {unit} from ideal).'


def assess(batch: RunningBatch) -> None:
    """Recomputes batch.latest_assessments in place - called once per tick,
    per running batch, from live/scheduler.py, right after refresh_prediction.

    For each deviating parameter this builds an `llm_context` dict (the full
    evidence: current/predicted values, golden comparison, confidence,
    time-to-breach, co-deviating parameters, ranked historical candidates)
    but does NOT call the LLM here - alert_registry.sync_from_assessment
    consumes llm_context, decides whether this is a new alert or a material
    change worth re-reasoning about, and calls app.live.llm_agent if so."""
    feature_row = compute_live_feature_row(batch.running_batch_id)
    assessments = []

    # First pass: figure out which parameters are deviating (current or
    # predicted) and in which direction, so root-cause candidates can be
    # ranked over the whole pattern (e.g. Pressure up + Flow Rate down
    # together) at once, not just one parameter in isolation.
    per_param = {}
    deviating_directions: dict[str, str] = {}

    latest_reading = get_latest_reading(batch.running_batch_id)
    if latest_reading is None:
        batch.latest_assessments = []
        return

    for key in live_config.PARAMETER_KEYS:
        label = PARAMETER_LABELS[key]
        unit = PARAMETER_UNITS[key]
        # The current value needs only the latest reading, not a full
        # 30-minute window - available from minute 0, unlike the prediction.
        current = getattr(latest_reading, key)

        lower, upper, golden = _dynamic_band(key, batch.elapsed_minutes)
        current_status = classify_actual(current, lower, upper).lower()
        current_observation = _observation(label, current_status, current, golden, unit)

        predicted_status = None
        predicted_observation = None
        time_to_breach = None
        confidence = None
        predicted_value = None
        predicted_golden = None
        pred = next((p for p in (batch.latest_prediction.parameters if batch.latest_prediction else []) if p.key == key), None)
        if pred is not None:
            pred_lower, pred_upper, pred_golden = _dynamic_band(key, batch.elapsed_minutes + 30)
            predicted_status = pred.alert_level.lower()
            predicted_observation = _observation(label, predicted_status, pred.predicted, pred_golden, unit)
            confidence = _confidence_from_ci(pred.ci_low, pred.ci_high, pred_lower, pred_upper)
            slope = feature_row.get(f'{key}_slope_30', 0.0) if feature_row else 0.0
            time_to_breach = _time_to_breach(current, slope, lower, upper)
            predicted_value = pred.predicted
            predicted_golden = pred_golden

        trigger_type = None
        if current_status != 'normal' and (predicted_status is None or predicted_status != 'normal'):
            trigger_type = 'both' if predicted_status not in (None, 'normal') else 'current'
        elif current_status == 'normal' and predicted_status not in (None, 'normal'):
            trigger_type = 'predicted'

        if trigger_type is not None:
            deviating_directions[key] = 'up' if current > golden else 'down'

        per_param[key] = {
            'label': label, 'unit': unit, 'current_status': current_status, 'current_observation': current_observation,
            'predicted_status': predicted_status, 'predicted_observation': predicted_observation,
            'time_to_breach': time_to_breach, 'confidence': confidence, 'trigger_type': trigger_type,
            'current': current, 'golden': golden, 'lower': lower, 'upper': upper,
            'predicted_value': predicted_value, 'predicted_golden': predicted_golden,
        }

    for key, info in per_param.items():
        llm_context = None
        if info['trigger_type'] is not None:
            root_cause_candidates = _rank_root_cause_candidates(deviating_directions, key)
            severity = 'Critical' if 'critical' in (info['current_status'], info['predicted_status'] or '') else 'Warning'
            co_deviating = [
                f"{per_param[k]['label']} {d}"
                for k, d in deviating_directions.items() if k != key
            ]
            llm_context = {
                'running_batch_id': batch.running_batch_id,
                'plant': batch.plant,
                'parameter_label': info['label'],
                'unit': info['unit'],
                'trigger_type': info['trigger_type'],
                'severity': severity,
                'current': {
                    'value': info['current'], 'golden': info['golden'],
                    'lower': info['lower'], 'upper': info['upper'], 'status': info['current_status'],
                },
                'predicted': ({
                    'value': info['predicted_value'], 'golden': info['predicted_golden'],
                    'status': info['predicted_status'], 'confidence': info['confidence'],
                    'time_to_breach_minutes': info['time_to_breach'],
                } if info['predicted_status'] is not None else None),
                'co_deviating': co_deviating,
                'root_cause_candidates': root_cause_candidates,
            }

        assessments.append(ParameterAssessment(
            key=key,
            current_status=info['current_status'],
            current_observation=info['current_observation'],
            predicted_status=info['predicted_status'],
            predicted_observation=info['predicted_observation'],
            time_to_breach_minutes=info['time_to_breach'],
            confidence=info['confidence'],
            likely_root_cause=None,
            recommended_action=None,
            trigger_type=info['trigger_type'],
            llm_context=llm_context,
        ))

    batch.latest_assessments = assessments
