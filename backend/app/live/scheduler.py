import asyncio

from app.live import config, deviation_agent, ml_bridge
from app.live.alert_registry import alert_registry
from app.live.registry import running_batch_registry


async def _tick_loop() -> None:
    while True:
        await asyncio.sleep(config.TICK_INTERVAL_SECONDS)
        running_batch_registry.tick_all()
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


def start() -> asyncio.Task:
    return asyncio.create_task(_tick_loop())
