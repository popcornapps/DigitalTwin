import asyncio

from app.live import config, ml_bridge
from app.live.registry import running_batch_registry


async def _tick_loop() -> None:
    while True:
        await asyncio.sleep(config.TICK_INTERVAL_SECONDS)
        running_batch_registry.tick_all()
        # Prediction refresh happens as its own pass, after telemetry - keeps
        # registry.tick_all() itself free of any ML dependency.
        for batch in running_batch_registry.list_batches():
            if batch.status == 'Running':
                ml_bridge.refresh_prediction(batch)


def start() -> asyncio.Task:
    return asyncio.create_task(_tick_loop())
