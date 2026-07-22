from app.config import WARNING_MARGIN_FRACTION


def classify_predicted(predicted: float, lo: float, hi: float, ci_low: float, ci_high: float) -> str:
    """CI-gated rule validated in the alerting-logic comparison: Critical only
    when the *entire* 90% interval is outside the band (eliminated false
    alarms with no recall loss); Warning when the point estimate is inside
    the band but close to an edge."""
    if ci_low > hi or ci_high < lo:
        return 'Critical'
    margin = (hi - lo) * WARNING_MARGIN_FRACTION
    if predicted < lo + margin or predicted > hi - margin:
        return 'Warning'
    return 'Normal'


def classify_actual(actual: float, lo: float, hi: float) -> str:
    """Same band, applied to a single real number - no ensemble, so no CI
    tier: a real reading either crossed the limit (Critical) or didn't."""
    if actual < lo or actual > hi:
        return 'Critical'
    margin = (hi - lo) * WARNING_MARGIN_FRACTION
    if actual < lo + margin or actual > hi - margin:
        return 'Warning'
    return 'Normal'


def correctness(predicted_alert: str, actual_alert: str) -> str:
    predicted_flagged = predicted_alert in ('Warning', 'Critical')
    actual_deviated = actual_alert in ('Warning', 'Critical')
    if predicted_flagged and actual_deviated:
        return 'Correct catch'
    if not predicted_flagged and not actual_deviated:
        return 'Correct quiet'
    if not predicted_flagged and actual_deviated:
        return 'Missed'
    return 'False alarm'
