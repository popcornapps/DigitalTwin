import asyncio
import logging

from app.live import config, deviation_agent, history_writer, kpi_prediction_agent, ml_bridge, service
from app.live.alert_registry import alert_registry
from app.live.registry import running_batch_registry
from app.state import app_state


async def _tick_loop() -> None:
    while True:
        await asyncio.sleep(config.TICK_INTERVAL_SECONDS)
        try:
            await _run_tick()
        except Exception:
            # Last-resort guard: every step inside _run_tick already catches
            # its own errors (see below), so this should never actually
            # trigger - but if something unforeseen still slips through, the
            # tick loop itself must survive it. This task is fire-and-forget
            # (see start()), so an uncaught exception here would otherwise
            # kill ticking for every batch, permanently, with nothing printed
            # until the process exits (asyncio only logs an unretrieved task
            # exception at garbage-collection time, not when it happens).
            logging.exception('Unhandled error in tick loop - this tick was skipped, loop continues')


async def _run_tick() -> None:
    newly_completed = running_batch_registry.tick_all()
    for running_batch_id in newly_completed:
        batch = running_batch_registry.get(running_batch_id)
        try:
            batch.is_daily_permanent = await history_writer.persist_completed_batch(batch, app_state)
        except Exception:
            # batch.persisted_at stays None; status stays 'Completed'; no
            # retry - simple is fine for this demo/synthetic system, just
            # must not crash the loop for other batches. is_daily_permanent
            # stays False - an unpersisted batch is temporary by definition.
            logging.exception('Failed to persist completed batch %s to history', running_batch_id)
        if config.AUTO_REPLENISH_BATCHES:
            # Continuous-demo mode: replace the batch that just finished
            # so the demo runs unattended forever, no manual "create
            # batch" needed. Guarded independently of the persist step
            # above - a failed persist shouldn't also stop the demo from
            # continuing.
            try:
                service.create_random_demo_batch(batch.plant)
            except Exception:
                logging.exception('Failed to auto-replenish a batch for plant %s', batch.plant)

    # Retention: keep only the latest DEMO_BATCH_RETENTION_COUNT finished
    # batches per plant (Completed or Stopped alike), fully deleting
    # anything older - memory, alerts, KPI reasoning cache, and persisted
    # history all at once (see service.prune_old_demo_batches). Runs
    # every tick, not just after a completion, so a manually-Stopped
    # batch ages out on the same schedule as a naturally-Completed one.
    try:
        service.prune_old_demo_batches(app_state)
    except Exception:
        logging.exception('Failed to prune old demo batches')
    # Postgres-level retention: once a plant's calendar day is no longer
    # today, keep only that day's one permanent batch - independent of (and
    # a fix for a gap in) prune_old_demo_batches above, which only sees
    # batches still tracked in the in-memory registry and so stops
    # protecting a day the moment the process restarts.
    try:
        service.enforce_past_day_batch_retention(app_state)
    except Exception:
        logging.exception('Failed to enforce past-day batch retention')
    # Separate, time-based sweep: alerts/recommendations/AI explanations
    # older than config.ALERT_RETENTION (24h) are deleted regardless of
    # which batch they belong to or whether that batch is temporary or
    # permanent - independent of the count-based prune above.
    try:
        service.purge_old_alerts()
    except Exception:
        logging.exception('Failed to purge old alerts')
    # Each pass runs after the previous one, in order - prediction needs
    # fresh telemetry, assessment needs the fresh prediction, and alerts
    # need the fresh assessment. Keeps registry.tick_all() itself free of
    # any ML/agent dependency.
    for batch in running_batch_registry.list_batches():
        if batch.status == 'Running':
            try:
                ml_bridge.refresh_prediction(batch)
                deviation_agent.assess(batch)
                for assessment in batch.latest_assessments:
                    await alert_registry.sync_from_assessment(batch, assessment)
                # predict_kpis() is itself a blocking call (it spawns and
                # joins its own ThreadPoolExecutor for LLM reasoning) - run it
                # off the event loop, same reasoning sync_from_assessment
                # already applies to its own LLM call above.
                kpi_result = await asyncio.to_thread(
                    kpi_prediction_agent.predict_kpis, batch.running_batch_id, batch.elapsed_minutes, batch.plant
                )
                # "Latest only" - same convention as latest_prediction/
                # latest_assessments above. app.routers.kpi_prediction reads
                # this directly rather than calling predict_kpis() itself, so
                # a page request is never the one blocking on a slow Agent
                # LLM call - that work already happened here, in the
                # background, on the scheduler's own clock.
                batch.latest_kpi_prediction = kpi_result
                if kpi_result is not None:
                    for kpi_calc in kpi_result['kpis']:
                        await alert_registry.sync_from_kpi_prediction(batch, kpi_calc)
            except Exception:
                # A bad prediction/assessment/KPI call for ONE batch must not
                # stop the others from being processed this tick, and must
                # not kill the tick loop itself (see _tick_loop's own guard
                # above) - previously nothing here caught this, so one
                # failure silently froze every running batch's simulated
                # clock forever, with no error ever logged.
                logging.exception(
                    'Failed to refresh prediction/assessment/KPI for running batch %s - skipping it for '
                    'this tick, other batches continue', batch.running_batch_id,
                )


def start() -> asyncio.Task:
    return asyncio.create_task(_tick_loop())
