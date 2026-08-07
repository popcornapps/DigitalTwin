"""The ONE file in app/live/ that imports from the historical/ML plane
(app.state, app.services). Everything else in app/live/ (config, models,
simulator, registry, scheduler) stays fully decoupled and has no idea any of
this exists - this module is the deliberate, narrow seam between them.

Reuses, completely unmodified:
- app_state.model / app_state.feature_columns / app_state.target_columns
  (the exact trained RandomForest, loaded once at startup)
- app.services.model_service.predict() (same function Deviation Prediction calls)
- app.services.alert_service.classify_predicted() (same CI-gated rule)

The only new logic here is a Python port of
scripts/build-training-dataset/rollingStats.ts's computeWindowStats, applied
to a live reading buffer instead of a precomputed CSV column. Per the
continuous-process design, all 4 parameters (including Agitator RPM) are
treated uniformly - there is no phase-aware exclusion here.
"""
from app.config import HORIZON_MINUTES, LOOKBACK_MINUTES
from app.live import config as live_config
from app.live.models import LiveParameterPrediction, LivePrediction, RunningBatch, TelemetryReading
from app.live.service import get_recent_readings
from app.services import model_service
from app.services.alert_service import classify_predicted
from app.state import app_state

REQUIRED_READINGS = LOOKBACK_MINUTES + 1  # t-30..t inclusive, matching buildFeatures.ts exactly


def _window_stats(values: list[float]) -> dict[str, float]:
    """Python port of rollingStats.ts's computeWindowStats - same formulas:
    population mean/std (divide by n, not n-1), and an OLS regression slope
    against position-in-window (not a naive two-point difference)."""
    n = len(values)
    current = values[-1]
    mean = sum(values) / n
    variance = sum((v - mean) ** 2 for v in values) / n
    std = variance ** 0.5
    minimum = min(values)
    maximum = max(values)

    xbar = (n - 1) / 2
    num = 0.0
    den = 0.0
    for i, v in enumerate(values):
        num += (i - xbar) * (v - mean)
        den += (i - xbar) ** 2
    slope = 0.0 if den == 0 else num / den

    return {'current': current, 'mean': mean, 'std': std, 'min': minimum, 'max': maximum, 'slope': slope}


def compute_live_feature_row(running_batch_id: str) -> dict | None:
    """Builds the same 25-key feature row shape as
    scripts/build-training-dataset/buildFeatures.ts, from live telemetry
    instead of a precomputed CSV. Returns None if fewer than 31 readings
    exist yet (not enough history for a 30-minute lookback window)."""
    readings: list[TelemetryReading] = get_recent_readings(running_batch_id, LOOKBACK_MINUTES)
    if len(readings) < REQUIRED_READINGS:
        return None

    latest = readings[-1]
    feature_row: dict = {'elapsed_minutes': latest.elapsed_minutes}
    for key in live_config.PARAMETER_KEYS:
        values = [getattr(r, key) for r in readings]
        stats = _window_stats(values)
        feature_row[f'{key}_current'] = round(stats['current'], 4)
        feature_row[f'{key}_mean_30'] = round(stats['mean'], 4)
        feature_row[f'{key}_std_30'] = round(stats['std'], 4)
        feature_row[f'{key}_min_30'] = round(stats['min'], 4)
        feature_row[f'{key}_max_30'] = round(stats['max'], 4)
        feature_row[f'{key}_slope_30'] = round(stats['slope'], 4)
    return feature_row


def refresh_prediction(batch: RunningBatch) -> None:
    """Recomputes batch.latest_prediction in place - called once per tick,
    per running batch, from live/scheduler.py. Overwrites whatever forecast
    was there before; no history of past forecasts is kept."""
    feature_row = compute_live_feature_row(batch.running_batch_id)
    if feature_row is None:
        batch.latest_prediction = None
        return

    model_output = model_service.predict(app_state, feature_row)

    parameters = []
    for key in live_config.PARAMETER_KEYS:
        lo, hi = app_state.parameter_limits[key]
        target_col = f'{key}_target_30min'
        pred = model_output[target_col]
        alert_level = classify_predicted(pred['predicted'], lo, hi, pred['ci_low'], pred['ci_high'])
        parameters.append(LiveParameterPrediction(
            key=key,
            predicted=round(pred['predicted'], 2),
            ci_low=round(pred['ci_low'], 2),
            ci_high=round(pred['ci_high'], 2),
            alert_level=alert_level,
        ))

    batch.latest_prediction = LivePrediction(
        horizon_minutes=HORIZON_MINUTES,
        computed_at_elapsed_minutes=batch.elapsed_minutes,
        parameters=parameters,
    )
