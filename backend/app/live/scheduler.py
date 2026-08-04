import asyncio
import logging

from app.live import config, deviation_agent, history_writer, kpi_prediction_agent, ml_bridge
from app.live.alert_registry import alert_registry
from app.live.registry import running_batch_registry
from app.state import app_state


async def _tick_loop() -> None:
    while True:
        await asyncio.sleep(config.TICK_INTERVAL_SECONDS)
        newly_completed = running_batch_registry.tick_all()
        for running_batch_id in newly_completed:
            batch = running_batch_registry.get(running_batch_id)
            try:
                history_writer.persist_completed_batch(batch, app_state)
            except Exception:
                # batch.persisted_at stays None; status stays 'Completed'; no
                # retry - simple is fine for this demo/synthetic system, just
                # must not crash the loop for other batches.
                logging.exception('Failed to persist completed batch %s to history', running_batch_id)
        # Each pass runs after the previous one, in order - prediction needs
        # fresh telemetry, assessment needs the fresh prediction, and alerts
        # need the fresh assessment. Keeps registry.tick_all() itself free of
        # any ML/agent dependency.
        for batch in running_batch_registry.list_batches():
            if batch.status == 'Running':
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
                if kpi_result is not None:
                    for kpi_calc in kpi_result['kpis']:
                        await alert_registry.sync_from_kpi_prediction(batch, kpi_calc)


def start() -> asyncio.Task:
    return asyncio.create_task(_tick_loop())
