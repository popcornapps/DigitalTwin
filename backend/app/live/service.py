"""Public API for the live-batch subsystem - the only module routers should
import from `app.live`. Thin wrapper over the registry; keeps the registry's
internal storage details out of the router layer, matching the existing
services/ pattern used for the historical plane.
"""
from app.live import config, history_writer
from app.live.models import RunningBatch, TelemetryReading
from app.live.registry import running_batch_registry
from app.state import AppState


def create_running_batch(plant: str, scenario_profile: str = 'Normal', drifting_parameter: str | None = None) -> RunningBatch:
    return running_batch_registry.create(plant, scenario_profile, drifting_parameter)


def list_running_batches() -> list[RunningBatch]:
    return running_batch_registry.list_batches()


def get_running_batch(running_batch_id: str) -> RunningBatch | None:
    return running_batch_registry.get(running_batch_id)


def get_telemetry_history(running_batch_id: str) -> list[TelemetryReading]:
    return running_batch_registry.get_history(running_batch_id)


def get_latest_reading(running_batch_id: str) -> TelemetryReading | None:
    """Available from minute 0 - unlike get_recent_readings (which needs a
    full 30-minute window for the ML feature vector), a single latest
    reading needs no history at all, which is why the Deviation Agent's
    CURRENT-value assessment doesn't have to wait for a prediction to exist."""
    history = running_batch_registry.get_history(running_batch_id)
    return history[-1] if history else None


def stop_running_batch(running_batch_id: str) -> RunningBatch | None:
    return running_batch_registry.stop(running_batch_id)


def delete_running_batch(running_batch_id: str, app_state: AppState) -> str:
    """Returns 'not_found' | 'still_running' | 'deleted'. Cascades: if the
    batch was ever persisted to history (naturally Completed), its Postgres
    batches/batch_kpis rows and in-memory AppState rows are deleted too, not
    just the in-memory live-batch entry - a no-op if it was never persisted
    (e.g. Stopped batches)."""
    batch = running_batch_registry.get(running_batch_id)
    if batch is None:
        return 'not_found'
    if batch.status == 'Running':
        return 'still_running'
    history_writer.delete_persisted_batch(batch, app_state)
    running_batch_registry.remove(running_batch_id)
    return 'deleted'


def get_recent_readings(running_batch_id: str, lookback_minutes: int = 30) -> list[TelemetryReading]:
    """The ML integration seam: returns the same trailing window shape that
    the historical pipeline's 30-minute rolling-stat features
    (scripts/build-training-dataset/rollingStats.ts) are computed from - used
    by app.live.ml_bridge. `>=` (not `>`) is deliberate: the training window
    is t-lookback_minutes through t INCLUSIVE, i.e. 31 points for a 30-minute
    lookback, not 30 - this must match exactly or the live feature vector
    would be computed over a different window than the model was trained on."""
    history = running_batch_registry.get_history(running_batch_id)
    if not history:
        return []
    latest_t = history[-1].elapsed_minutes
    return [r for r in history if r.elapsed_minutes >= latest_t - lookback_minutes]


def seed_default_batches() -> None:
    """Creates the 3 default running batches (Normal/Warning/Critical) once
    at backend startup, per the running-batch design's confirmed scope."""
    for spec in config.DEFAULT_SEED_BATCHES:
        create_running_batch(spec['plant'], spec['scenario_profile'], spec['drifting_parameter'])
