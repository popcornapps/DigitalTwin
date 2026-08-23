"""Public API for the live-batch subsystem - the only module routers should
import from `app.live`. Thin wrapper over the registry; keeps the registry's
internal storage details out of the router layer, matching the existing
services/ pattern used for the historical plane.
"""
import logging
import random
from datetime import datetime, timezone

from app.config import plant_local_date
from app.live import config, history_writer
from app.live.alert_registry import alert_registry
from app.live.models import RunningBatch, TelemetryReading
from app.live.registry import running_batch_registry
from app.state import AppState

logger = logging.getLogger(__name__)

# Lazy import inside functions below (kpi_prediction_agent already imports
# this module for get_recent_readings - a module-level import here would
# close that into a real circular import, same reasoning history_writer.py's
# own lazy imports already document).


def create_running_batch(
    plant: str, scenario_profile: str = 'Normal', drifting_parameter: str | None = None,
) -> RunningBatch:
    return running_batch_registry.create(plant, scenario_profile, drifting_parameter)


def create_random_demo_batch(plant: str) -> RunningBatch:
    """Creates one replacement batch drawn from config.DEMO_SCENARIO_POOL -
    called both when a batch naturally Completes (scheduler.py's tick loop)
    and when one is manually Stopped (stop_running_batch below), whenever
    config.AUTO_REPLENISH_BATCHES is on - the running pool should stay
    constant regardless of HOW a batch ended, not just one of the two ways.
    enforce_daily_cap=False: this is the system replacing a batch that just
    ended, not a human spamming manual creation - see registry.create()'s
    own comment on why that cap shouldn't apply here."""
    pool = config.DEMO_SCENARIO_POOL
    weights = [entry['weight'] for entry in pool]
    choice = random.choices(pool, weights=weights, k=1)[0]
    return running_batch_registry.create(
        plant, choice['scenario_profile'], choice['drifting_parameter'], enforce_daily_cap=False,
    )


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
    """Manually stopping a batch is one of the two ways a batch leaves the
    running pool (the other is natural completion, handled in scheduler.py) -
    replenishes it the same way, so the pool size doesn't quietly shrink just
    because a batch was stopped rather than left to finish on its own. Only
    fires if this call actually transitioned Running -> Stopped (calling
    stop() on an already-Stopped/Completed batch, or an unknown id, is a
    no-op and shouldn't spawn an extra batch)."""
    batch = running_batch_registry.get(running_batch_id)
    was_running = batch is not None and batch.status == 'Running'
    stopped = running_batch_registry.stop(running_batch_id)
    if was_running and config.AUTO_REPLENISH_BATCHES:
        try:
            create_random_demo_batch(stopped.plant)
        except Exception:
            # The stop itself already succeeded - a failed replenish
            # shouldn't turn a successful stop request into an error.
            logger.exception('Failed to auto-replenish after manually stopping %s', running_batch_id)
    return stopped


def delete_running_batch(running_batch_id: str, app_state: AppState) -> str:
    """Returns 'not_found' | 'still_running' | 'deleted'. Cascades: if the
    batch was ever persisted to history (naturally Completed), its Postgres
    batches/batch_kpis rows and in-memory AppState rows are deleted too, not
    just the in-memory live-batch entry - a no-op if it was never persisted
    (e.g. Stopped batches). Also deletes this batch's alerts (Open or
    Resolved) and its cached KPI reasoning - previously left behind
    indefinitely by this function; harmless for one-off manual deletes, but
    would grow forever under continuous demo cycling, so this is now also
    the single cascade prune_old_demo_batches reuses below."""
    from app.live.kpi_prediction_agent import purge_reasoning_cache  # see module docstring - avoids a circular import

    batch = running_batch_registry.get(running_batch_id)
    if batch is None:
        return 'not_found'
    if batch.status == 'Running':
        return 'still_running'
    history_writer.delete_persisted_batch(batch, app_state)
    alert_registry.delete_for_batch(running_batch_id)
    purge_reasoning_cache(running_batch_id)
    running_batch_registry.remove(running_batch_id)
    return 'deleted'


def enforce_past_day_batch_retention(app_state: AppState) -> list[str]:
    """Thin wrapper, same convention as prune_old_demo_batches below - the
    actual Postgres-level logic lives in history_writer.py (which already
    owns every other persisted-batch write/delete). Unlike
    prune_old_demo_batches (in-memory registry only, so it stops protecting
    a day the moment the process restarts), this reads/writes
    app_state.batches_df/batch_kpis_df directly, so it keeps working
    correctly across restarts - see history_writer.enforce_past_day_retention
    for why that distinction matters."""
    return history_writer.enforce_past_day_retention(app_state)


def prune_old_demo_batches(app_state: AppState) -> list[str]:
    """Keeps only the latest config.DEMO_BATCH_RETENTION_COUNT finished
    (Completed OR Stopped) TEMPORARY batches PER PLANT fully available, AND
    only from TODAY'S calendar date (UTC) - whichever limit a batch hits
    first, it's deleted via the exact same cascade delete_running_batch
    already performs (memory + alerts + KPI reasoning cache + persisted
    history). Two independent triggers:
      1. Count-based: beyond the latest DEMO_BATCH_RETENTION_COUNT for its plant.
      2. Day-boundary: its terminal_at (when it left Running) falls on a
         PLANT-LOCAL (IST) calendar date before today - the moment a new
         plant-local day starts, every temporary batch left over from the
         previous day is removed, even if it would otherwise still be within
         the count-based window. Applies equally to manually-Stopped and
         naturally-Completed batches, and to both manually- and
         automatically-created ones - nothing here distinguishes by how a
         batch was created, only by how it ended. Uses plant_local_date, not
         a raw UTC date, so this boundary agrees with the same IST day the
         daily-permanent tagging (history_writer._is_first_completion_today)
         and the dashboard's "Completed today" bucketing already use - a UTC
         boundary here would drift by up to 5.5 hours against those.
    Batches with is_daily_permanent=True (see history_writer.
    persist_completed_batch) are excluded entirely from BOTH triggers -
    they're permanent historical data now, counted in Plant KPI/Batch
    Explorer, and must never be deleted by this policy, regardless of which
    day they're from. Called every scheduler tick (see scheduler.py) - cheap:
    just an in-memory scan, and almost always a no-op once the pool is
    already at steady state. Returns the running_batch_ids actually purged,
    for logging/testing."""
    today = plant_local_date(datetime.now(timezone.utc))
    finished = [
        b for b in running_batch_registry.list_batches()
        if b.status in ('Completed', 'Stopped') and not b.is_daily_permanent
    ]
    by_plant: dict[str, list[RunningBatch]] = {}
    for batch in finished:
        by_plant.setdefault(batch.plant, []).append(batch)

    purged: list[str] = []
    for plant_batches in by_plant.values():
        plant_batches.sort(key=lambda b: b.terminal_at or b.started_at, reverse=True)
        for idx, batch in enumerate(plant_batches):
            terminal_date = plant_local_date(batch.terminal_at or batch.started_at)
            beyond_count = idx >= config.DEMO_BATCH_RETENTION_COUNT
            from_a_previous_day = terminal_date < today
            if (beyond_count or from_a_previous_day) and delete_running_batch(batch.running_batch_id, app_state) == 'deleted':
                purged.append(batch.running_batch_id)
    return purged


def purge_old_alerts() -> int:
    """Deletes every alert older than config.ALERT_RETENTION regardless of
    which batch it belongs to or whether that batch is temporary or
    permanent - a separate, continuously-running sweep (see scheduler.py)
    from prune_old_demo_batches' per-batch delete above. Returns the number
    of rows deleted, for logging/testing."""
    cutoff = datetime.now(timezone.utc) - config.ALERT_RETENTION
    return alert_registry.delete_older_than(cutoff)


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
    """Creates config.DEFAULT_SEED_BATCH_COUNT (2) default running batches
    once at backend startup - one Critical, one Warning, each with a
    distinct, randomly chosen parameter drawn from config.
    FAULT_CAPABLE_PARAMETERS (the same pool create_random_demo_batch draws
    from for auto-replenishment), so a fresh restart doesn't always
    reproduce the exact same fixed scenario."""
    plant = config.PLANTS[0]
    critical_parameter, warning_parameter = random.sample(config.FAULT_CAPABLE_PARAMETERS, config.DEFAULT_SEED_BATCH_COUNT)
    create_running_batch(plant, 'Critical', critical_parameter)
    create_running_batch(plant, 'Warning', warning_parameter)
