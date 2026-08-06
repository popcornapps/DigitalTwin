"""The KPI Prediction & Deviation Agent - predicts each running batch's FINAL
Yield, Quality Score, SEC, OEE, and Total Energy (not a 30-min-ahead
snapshot) from the last 30 minutes of process parameters available at any
point in the batch, compares each to the Golden Batch's final target,
classifies Normal/Warning/Critical, ranks the process parameters most
responsible, and generates a corrective recommendation.

End-of-batch, not 30-min-ahead: an earlier version of this agent predicted a
KPI "snapshot" 30 minutes into the future, mirroring the Process Parameter
Deviation Agent's rolling horizon. That was the wrong framing - Yield/
Quality Score/SEC/OEE/Total Energy are inherently single, end-of-batch
outcomes (a batch has one final yield, not a yield-at-every-minute), unlike
Temperature/Pressure/Flow Rate/Agitator RPM, which are genuinely continuous
signals. Predicting a batch's final outcome from in-process data ("soft
sensing") is standard practice in batch-manufacturing ML. This agent's INPUT
is unchanged from that earlier version - still the last 30-minute trailing
window - only what the model's output represents changed. Predictions made
early in a batch are honestly less reliable than ones made later (a row
sampled before a parameter's drift onset looks statistically identical to a
Normal batch, yet the eventual outcome may differ) - this is communicated
through the existing confidence score, not hidden behind a stronger gate.

Scope: this agent only ever serves Hyderabad Plant / Paracetamol 500mg -
the only plant/product the live-batch subsystem simulates at all (see
backend/app/live/config.py's PLANTS and registry.py's hardcoded product
string). The underlying model is trained on synthetic data generated for
exactly that plant/product (see scripts/generate-synthetic-kpi-data/
generate_synthetic_kpi_data.py's PLANT/PRODUCT constants).

Computed on demand (called from app.routers.kpi_prediction, not wired into
live/scheduler.py's per-tick loop). Reads compute_live_feature_row (the
model's input features) and get_recent_readings (raw readings, for
residual-based root-cause scoring - see _residual_stats) from the existing
live pipeline - pure, read-only, never mutated - plus
live_config.get_parameter_config()'s upper/lower limits (Postgres-backed
reference data) for the deviation-score normalization scale, and
golden_reference.py for both the final-KPI comparison target and the
root-cause baseline (see below) - the same shared module
deviation_agent.py uses, so all three comparisons on this page read from
the same real PAR-GOLDEN data.

Root-cause ranking measures each parameter's deviation against PAR-GOLDEN's
own ACTUAL recorded value at that same elapsed minute (golden_reference.
golden_value_at), not a single flat constant - process parameters
legitimately sit far from any one constant depending on phase (e.g. Flow
Rate is 0 before the transfer phase, Agitator RPM is 0 during drying), and
PAR-GOLDEN's own real trajectory already captures that phase-dependence
empirically. Comparing against a flat constant would flag every early-phase
batch as a severe deviation regardless of whether anything is actually
wrong - the same "100% of batches falsely flagged" bug class app.config's
DRYING_WINDOW_* constants were introduced to prevent for the real pipeline.
(This used to be computed from hardcoded phase-correct baseline formulas
ported from simulator.py, requiring this batch's own inferred phase
boundaries - replaced with a direct PAR-GOLDEN lookup for consistency with
the rest of this page, and because it's simpler: no boundary-inference
needed when comparing directly against a real recorded batch.) This
root-cause logic is unrelated to the KPI's prediction horizon and was
unchanged by the 30-min-ahead -> end-of-batch reframing.

The model itself is trained on fully synthetic data - see that script's
module docstring for why: none of these 5 KPIs have genuine within-batch
temporal signal in the real historical data, so the synthetic generator
defines that relationship explicitly instead of trying to learn one that
doesn't exist - and does so through the same physical dependency chain the
real historical generator uses (Process Parameters -> Stability ->
Yield/Energy/Assay -> OEE), not independent per-KPI formulas. Only the
model itself is synthetic-trained; the comparison target (golden_reference.
golden_final_kpis) is PAR-GOLDEN's real recorded outcome, not a synthetic
one - the two were already close in practice (e.g. real Yield 99.77% vs the
old computed-ideal 100.0%), confirming the synthetic generator was well
calibrated to the real golden batch in the first place.
"""
import concurrent.futures
import json

import joblib
import numpy as np

from app.config import MODEL_DIR, PARAMETER_LABELS, PARAMETER_UNITS
from app.live import ai_mode, config as live_config
from app.live import golden_reference
from app.live import kpi_llm_agent
from app.live.ml_bridge import compute_live_feature_row
from app.live.service import get_recent_readings

# Points at the 12-parameter model (scripts/train-synthetic-kpi-model/
# train_synthetic_kpi_model_12param.py) - the original 4-parameter
# synthetic_kpi_random_forest.joblib/manifest stay on disk, just
# unreferenced, so this is a reversible cutover, not a deletion.
MODEL_PATH = MODEL_DIR / 'synthetic_kpi_random_forest_12param.joblib'
MANIFEST_PATH = MODEL_DIR / 'synthetic_kpi_random_forest_12param_manifest.json'

KPI_LABELS = {
    'yield_pct': 'Yield',
    'quality_score_pct': 'Quality Score',
    'sec_kwh_per_kg': 'Specific Energy Consumption (SEC)',
    'oee_pct': 'OEE',
    'total_energy_kwh': 'Total Energy Consumption',
}
KPI_UNITS = {
    'yield_pct': '%', 'quality_score_pct': '%', 'sec_kwh_per_kg': 'kWh/kg', 'oee_pct': '%', 'total_energy_kwh': 'kWh',
}
# SEC and Total Energy are the two KPIs here where LOWER is better (less
# energy consumed) - every other KPI is higher-is-better. This flips how
# "deviation" maps to Normal/Warning/Critical below.
LOWER_IS_BETTER = {
    'yield_pct': False, 'quality_score_pct': False, 'sec_kwh_per_kg': True, 'oee_pct': False, 'total_energy_kwh': True,
}

WARNING_THRESHOLD_PCT = 5.0
CRITICAL_THRESHOLD_PCT = 15.0

# Rows shown in the small multi-parameter history table - shorter than
# Process Monitoring's own History table (10 min) since this page already
# has a lot of vertical content above/below it.
HISTORY_MINUTES = 5

# Caches the last reasoning generated per (running_batch_id, kpi_key), keyed
# by a cheap fingerprint (status + leading root-cause parameter) -
# regenerated only when that fingerprint actually changes, not on every poll
# and NOT on every small wobble in the predicted number itself. The LLM is
# an explanation engine here, not a value-tracker - the numeric fields
# (predicted_final/golden_final/deviation_pct/confidence) already update on
# every single call regardless of this cache (see the calcs loop below), so
# the operator always sees fresh numbers; only the qualitative explanation/
# recommendation text is held stable until the SITUATION actually changes
# (alert severity, or which parameter is the primary cause) - same
# principle the real Deviation Agent's alert_registry already applies.
_reasoning_cache: dict[tuple[str, str], tuple[tuple, dict]] = {}

# Nominal batch length, in minutes - still used below by _evidence_ceiling
# to judge "how much of a batch has actually happened yet" for confidence.
# (The phase-correct baseline formulas that used to live in this section -
# _infer_phase_boundaries, _baseline_value, and friends - were removed: root
# cause now compares against PAR-GOLDEN's own real recorded value at each
# elapsed minute via golden_reference.golden_value_at, which is both simpler
# - no per-batch phase-boundary inference needed - and consistent with the
# rest of this page. See module docstring.)
NOMINAL_PHASE_DURATIONS = {'dispensing': 25, 'dry_mixing': 20, 'wet_massing': 25, 'transfer': 15, 'drying': 270, 'cooling': 30}
NOMINAL_TOTAL_DURATION = sum(NOMINAL_PHASE_DURATIONS.values())  # 385


_model_cache = None
_manifest_cache = None


def _load():
    global _model_cache, _manifest_cache
    if _model_cache is None:
        _manifest_cache = json.loads(MANIFEST_PATH.read_text())
        _model_cache = joblib.load(MODEL_PATH)
    # golden_reference.golden_final_kpis() has its own cache, and PAR-GOLDEN's
    # batch_kpis row is a fixed reference - fetched via the shared module
    # every call is cheap (cache hit after the first), and keeps this
    # function's return value shaped exactly as callers already expect.
    return _model_cache, _manifest_cache, golden_reference.golden_final_kpis()


def _classify(bad_deviation_pct: float) -> str:
    """bad_deviation_pct is already sign-normalized so positive always means
    'worse than golden', regardless of whether the KPI is higher- or
    lower-is-better - see the LOWER_IS_BETTER flip in predict_kpis below."""
    if bad_deviation_pct >= CRITICAL_THRESHOLD_PCT:
        return 'critical'
    if bad_deviation_pct >= WARNING_THRESHOLD_PCT:
        return 'warning'
    return 'normal'


CONFIDENCE_RANK = {'Low': 0, 'Medium': 1, 'High': 2}

# Below this fraction of a nominal batch's duration, even a batch that IS
# going to drift may not have reached its own randomized onset yet (see
# generate_synthetic_kpi_data.py's _sample_onset) - rows this early look
# statistically similar whether or not a fault is coming, so the Random
# Forest's own trees can agree tightly on a value that's really just "the
# population's usual outcome," not a real read on THIS batch. That
# agreement is genuine, but it isn't the same thing as being right about
# this specific batch - see _evidence_ceiling below.
EARLY_BATCH_FRACTION = 0.25
# Above this fraction, most batches' fault onsets (if any) should already
# have shown up in the trailing window - full tree-agreement-based
# confidence is allowed from here on.
MID_BATCH_FRACTION = 0.55


def _evidence_ceiling(elapsed_minutes: int) -> str:
    """Caps how much confidence is honest to claim based on how much of a
    nominal batch has actually elapsed, independent of the model's own tree
    agreement. This is what stops an early-batch prediction from reading as
    'High confidence' just because the trees happen to agree - see
    EARLY_BATCH_FRACTION/MID_BATCH_FRACTION."""
    fraction = elapsed_minutes / NOMINAL_TOTAL_DURATION
    if fraction < EARLY_BATCH_FRACTION:
        return 'Low'
    if fraction < MID_BATCH_FRACTION:
        return 'Medium'
    return 'High'


def _confidence_reason(tree_confidence: str, ceiling: str) -> str:
    """Plain-language explanation for WHY confidence landed where it did -
    shown to the operator alongside the High/Medium/Low badge, not just the
    badge alone. Deliberately distinguishes two different situations that
    both look like "low confidence" but call for different operator
    reactions: not enough of the batch has happened yet (time-limited -
    simply wait, it will resolve), vs. the model's own estimate still
    disagrees with itself even with plenty of history observed (this batch
    may just be a genuinely harder call, e.g. a mild/ambiguous fault) -
    waiting longer won't necessarily help that second case."""
    if ceiling == 'Low':
        return 'Batch just started - too early to trust this yet'
    if tree_confidence == 'Low':
        return 'The outcome is still genuinely unclear right now'
    if ceiling == 'Medium':
        return 'Batch is partway through - prediction may still change'
    if tree_confidence == 'Medium':
        return "Enough time has passed, but the prediction hasn't fully settled yet"
    return 'Batch is far enough along - prediction is reliable'


def _confidence_from_ci(ci_low: float, ci_high: float, golden: float, elapsed_minutes: int) -> tuple[str, str]:
    """Combines the model's own tree-spread agreement (how tightly the
    forest's individual trees agree on a value) with how much of the batch
    has actually been observed (_evidence_ceiling) - takes whichever is MORE
    conservative (lower). A prediction can only read as confident once both
    the model agrees AND enough of the batch has actually happened to
    justify that agreement, not just one or the other. Returns (level,
    reason) - the plain-language reason is what actually makes this
    meaningful to an operator, not just the level on its own."""
    if not golden:
        return 'Low', 'Batch just started - too early to trust this yet'
    ratio = abs(ci_high - ci_low) / abs(golden)
    if ratio < 0.05:
        tree_confidence = 'High'
    elif ratio < 0.15:
        tree_confidence = 'Medium'
    else:
        tree_confidence = 'Low'

    ceiling = _evidence_ceiling(elapsed_minutes)
    level = tree_confidence if CONFIDENCE_RANK[tree_confidence] <= CONFIDENCE_RANK[ceiling] else ceiling
    return level, _confidence_reason(tree_confidence, ceiling)


def _band_half_width(key: str) -> float:
    cfg = live_config.get_parameter_config()[key]
    return (cfg['upper_limit'] - cfg['lower_limit']) / 2


def _residual_stats(readings: list, key: str) -> tuple[float, float]:
    """Mean and (population) std of the RESIDUAL (actual minus PAR-GOLDEN's
    own real recorded value, evaluated AT EACH reading's own elapsed minute -
    not a single "now" or window-average baseline) across the given
    readings. This must be computed pointwise, not via mean_30/std_30 (which
    describe the RAW value's own spread): during a fast, entirely normal
    transition (e.g. Flow Rate ramping 0 -> 48.5 over ~7 minutes), the raw
    value's std over a 30-minute window is naturally huge simply because the
    EXPECTED value itself sweeps through a wide range - that's not
    instability, and feeding it into the deviation score conflated the two,
    producing a large false score throughout every transition even when the
    batch was tracking PAR-GOLDEN's own curve perfectly. Computing the
    residual at each point first removes that sweep entirely, leaving only
    real deviation from expected."""
    residuals = []
    for r in readings:
        baseline_t = golden_reference.golden_value_at(key, r.elapsed_minutes)
        residuals.append(getattr(r, key) - baseline_t)
    arr = np.array(residuals)
    return float(arr.mean()), float(arr.std())


def _parameter_deviation(readings: list, key: str, elapsed_minutes: int) -> dict:
    latest = readings[-1]
    baseline_now = golden_reference.golden_value_at(key, elapsed_minutes)
    half_width = _band_half_width(key)
    current = getattr(latest, key)

    residual_mean, residual_std = _residual_stats(readings, key)
    # Normalized deviation from the phase-correct baseline (0 = tracking it
    # exactly, ~1 = at the edge of the normal band, >1 = beyond it) - factors
    # in both how far off the average is and how unstable/jumpy the RESIDUAL
    # itself has been (not the raw value's own spread - see _residual_stats).
    deviation_score = abs(residual_mean) / half_width + 0.4 * (residual_std / half_width)
    direction = 'up' if current > baseline_now else ('down' if current < baseline_now else 'stable')
    return {
        'key': key,
        'label': PARAMETER_LABELS[key],
        'unit': PARAMETER_UNITS[key],
        'current': round(current, 2),
        'golden': round(baseline_now, 2),
        'deviation': round(current - baseline_now, 2),
        'direction': direction,
        'deviation_score': round(deviation_score, 3),
    }


def predict_kpis(running_batch_id: str, elapsed_minutes: int, plant: str) -> dict | None:
    """Returns a dict shaped for KpiPredictionResponse, or None if the batch
    doesn't have 30+ minutes of history yet (same "no fabricated placeholder
    forecast" rule the parameter agent's own prediction follows - this input
    gate is about the feature window, unrelated to the end-of-batch
    reframing, so it's unchanged)."""
    feature_row = compute_live_feature_row(running_batch_id)
    if feature_row is None:
        return None

    model, manifest, golden = _load()
    x = np.array([[feature_row[c] for c in manifest['feature_columns']]])
    point_pred = model.predict(x)[0]
    tree_preds = np.stack([tree.predict(x) for tree in model.estimators_])[:, 0, :]
    ci_low = np.percentile(tree_preds, 5, axis=0)
    ci_high = np.percentile(tree_preds, 95, axis=0)

    recent_readings = get_recent_readings(running_batch_id, 30)

    parameter_deviations = {
        key: _parameter_deviation(recent_readings, key, elapsed_minutes) for key in live_config.PARAMETER_KEYS
    }
    ranked_parameters = sorted(parameter_deviations.values(), key=lambda p: p['deviation_score'], reverse=True)

    # Pass 1: all deterministic calculations (fast, no network calls) for
    # every KPI, and figure out which ones actually need a fresh reasoning
    # call vs. which can reuse a cached one.
    current_ai_mode = ai_mode.get_mode()
    calcs = []
    for i, target_col in enumerate(manifest['target_columns']):
        kpi_key = target_col.replace('_final', '')
        predicted = float(point_pred[i])
        golden_value = golden.get(target_col, predicted)
        raw_deviation_pct = ((predicted - golden_value) / golden_value * 100) if golden_value else 0.0
        bad_deviation_pct = raw_deviation_pct if LOWER_IS_BETTER[kpi_key] else -raw_deviation_pct
        status = _classify(bad_deviation_pct)
        confidence, confidence_reason = _confidence_from_ci(float(ci_low[i]), float(ci_high[i]), golden_value, elapsed_minutes)
        top_contributors = [p for p in ranked_parameters if p['deviation_score'] > 0.3][:3] or ranked_parameters[:1]

        # Deliberately does NOT include the predicted value - the LLM is an
        # explanation engine, not something that should re-run every time the
        # number wobbles slightly tick to tick (that number keeps updating in
        # the UI regardless, from predicted/golden_value above - only the
        # cached reasoning TEXT is held stable). A fresh reasoning call only
        # fires when the situation itself changes: alert severity (status)
        # or the primary contributing parameter. Also includes the current
        # AI mode so flipping the Static/Agent LLM toggle always forces a
        # fresh reasoning attempt, even if nothing else changed - otherwise a
        # cached Static-mode result could keep being served after switching
        # to Agent LLM mode.
        fingerprint = (current_ai_mode, status, top_contributors[0]['key'] if top_contributors else None)
        cache_key = (running_batch_id, kpi_key)
        cached = _reasoning_cache.get(cache_key)

        calcs.append({
            'kpi_key': kpi_key, 'predicted': predicted, 'golden_value': golden_value,
            'raw_deviation_pct': raw_deviation_pct, 'status': status, 'confidence': confidence,
            'confidence_reason': confidence_reason,
            'top_contributors': top_contributors, 'fingerprint': fingerprint, 'cache_key': cache_key,
            'reasoning': cached[1] if (cached is not None and cached[0] == fingerprint) else None,
        })

    # Pass 2: only the cache misses need a real reasoning call - run those
    # CONCURRENTLY (a thread per KPI, up to 5), not one after another. In
    # Agent LLM mode each call is a real Azure OpenAI request; running them
    # sequentially meant total latency was ~5x a single call's latency (once
    # observed at ~37s for 5 KPIs) - concurrently, it's ~1x. Static mode calls
    # are already near-instant so this doesn't matter there, but costs
    # nothing either way.
    to_compute = [c for c in calcs if c['reasoning'] is None]
    if to_compute:
        def _reason_for(calc):
            return kpi_llm_agent.generate_kpi_reasoning({
                'running_batch_id': running_batch_id,
                'plant': plant,
                'elapsed_minutes': elapsed_minutes,
                'kpi_label': KPI_LABELS[calc['kpi_key']],
                'unit': KPI_UNITS[calc['kpi_key']],
                'predicted': calc['predicted'],
                'golden': calc['golden_value'],
                'deviation_pct': calc['raw_deviation_pct'],
                'status': calc['status'],
                'confidence': calc['confidence'],
                'contributing_parameters': calc['top_contributors'],
            })

        with concurrent.futures.ThreadPoolExecutor(max_workers=len(to_compute)) as executor:
            fresh_reasonings = list(executor.map(_reason_for, to_compute))
        for calc, reasoning in zip(to_compute, fresh_reasonings):
            calc['reasoning'] = reasoning
            _reasoning_cache[calc['cache_key']] = (calc['fingerprint'], reasoning)

    kpis = [
        {
            'key': c['kpi_key'],
            'label': KPI_LABELS[c['kpi_key']],
            'unit': KPI_UNITS[c['kpi_key']],
            'predicted_final': round(c['predicted'], 3),
            'golden_final': round(c['golden_value'], 3),
            'deviation_pct': round(c['raw_deviation_pct'], 2),
            'status': c['status'],
            'confidence': c['confidence'],
            'confidence_reason': c['confidence_reason'],
            'contributing_parameters': c['top_contributors'],
            'kpi_summary': c['reasoning']['kpi_summary'],
            'deviation_explanation': c['reasoning']['deviation_explanation'],
            'urgency': c['reasoning']['urgency'],
            'recommended_action': c['reasoning']['recommended_action'],
            'operational_impact': c['reasoning']['operational_impact'],
            'reasoning_source': c['reasoning']['reasoning_source'],
        }
        for c in calcs
    ]

    # Newest-first, last HISTORY_MINUTES readings - all 12 process parameters,
    # not just whichever 1-3 are flagged as top contributors above. Same
    # convention as Process Monitoring's own History table.
    history = [
        {
            'elapsed_minutes': r.elapsed_minutes,
            'temperature': r.temperature,
            'process_pressure': r.process_pressure,
            'flow_rate': r.flow_rate,
            'agitator_rpm': r.agitator_rpm,
            'inlet_air_humidity': r.inlet_air_humidity,
            'exhaust_air_temp': r.exhaust_air_temp,
            'filter_differential_pressure': r.filter_differential_pressure,
            'shaker_vibration_frequency': r.shaker_vibration_frequency,
            'product_bed_temp': r.product_bed_temp,
            'chamber_differential_pressure': r.chamber_differential_pressure,
            'ahu_damper_position': r.ahu_damper_position,
            'compressed_air_pressure': r.compressed_air_pressure,
        }
        for r in reversed(recent_readings[-HISTORY_MINUTES:])
    ]

    return {
        'running_batch_id': running_batch_id,
        'elapsed_minutes': elapsed_minutes,
        'kpis': kpis,
        'history': history,
    }
