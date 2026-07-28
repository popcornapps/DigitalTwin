"""Deterministic, evidence-based confidence scoring for the Deviation Agent's
diagnosis - deliberately its own module, not a field the LLM fills in and not
a method on deviation_agent.py, so this scoring logic can later be replaced
with a data-driven model (e.g. trained on real corrective-action outcomes)
without touching any caller.

This is NOT the existing `confidence` field on ParameterAssessment/
DeviationAlert - that one measures how tight the ML forecast's confidence
interval is. This module answers a different question: how much should the
diagnosis (likely root cause) and the corrective action built on it be
trusted, given the historical evidence gathered in
deviation_agent._rank_root_cause_candidates.

Not a statistically validated probability - a reasonable, explainable
estimate for a demo, deliberately built only from numbers already computed
elsewhere (match_fraction, batch_count), not invented.
"""

_LEVEL_THRESHOLDS = (
    (70, 'High'),
    (40, 'Medium'),
)

# batch_count at/above this is treated as full evidence-volume strength -
# calibrated against the real fault-signature dataset, whose batch_count
# values range 1-10.
_FULL_EVIDENCE_BATCH_COUNT = 10

# Match completeness matters more than evidence volume: a perfect signature
# match backed by only 1 historical batch should still outweigh a 33% match
# backed by 10, so match gets the larger weight.
_MATCH_WEIGHT = 0.7
_EVIDENCE_WEIGHT = 0.3

_NO_MATCH_CONFIDENCE = {
    'confidence_pct': 15,
    'confidence_level': 'Low',
    'explanation': 'No historical batch shows a matching pattern for this deviation - novel or unclassified.',
}


def _level_for(pct: int) -> str:
    for threshold, label in _LEVEL_THRESHOLDS:
        if pct >= threshold:
            return label
    return 'Low'


def score_root_cause(candidates: list[dict]) -> dict:
    """candidates: the ranked list from deviation_agent._rank_root_cause_candidates
    (best match first). Returns {'confidence_pct', 'confidence_level',
    'explanation'} - always returns a value, even with no candidates, so
    callers never need a None-check."""
    if not candidates:
        return dict(_NO_MATCH_CONFIDENCE)

    top = candidates[0]
    match_fraction = top['match_fraction']
    batch_count = top['batch_count']

    evidence_strength = min(batch_count / _FULL_EVIDENCE_BATCH_COUNT, 1.0)
    combined = _MATCH_WEIGHT * match_fraction + _EVIDENCE_WEIGHT * evidence_strength
    pct = round(combined * 100)
    level = _level_for(pct)

    match_pct = round(match_fraction * 100)
    batch_word = 'batch' if batch_count == 1 else 'batches'
    if match_fraction >= 1.0:
        explanation = f"Full historical signature match ({match_pct}%) across {batch_count} historical {batch_word}."
    elif match_fraction >= 0.5:
        explanation = f"Partial historical match ({match_pct}% of expected parameters), supported by {batch_count} historical {batch_word}."
    else:
        explanation = f"Weak historical match ({match_pct}% of expected parameters) - limited historical evidence ({batch_count} {batch_word})."

    return {'confidence_pct': pct, 'confidence_level': level, 'explanation': explanation}


def score_recommendation(root_cause_confidence: dict) -> dict:
    """The recommended action is derived directly from the root cause
    diagnosis (both the LLM path and the deterministic fallback build the
    action from the same top candidate), so its confidence mirrors the root
    cause score rather than being independently measured - there's no
    separate signal (e.g. "did this action work historically") tracked in
    the current data to score it on its own."""
    pct = root_cause_confidence['confidence_pct']
    level = root_cause_confidence['confidence_level']
    explanation = f"Based on the {level.lower()}-confidence root cause diagnosis above ({pct}% confidence)."
    return {'confidence_pct': pct, 'confidence_level': level, 'explanation': explanation}
