"""In-memory store of all running batches and their telemetry history. Lives
only for the FastAPI process's lifetime - a running batch's history is not
persisted anywhere and does not touch paracetamol_batches.csv/timeseries.csv
(that dataset is the ML training ground truth and stays exactly as generated;
these are ephemeral simulation runs, not new training data).
"""
from datetime import datetime, timezone

from app.config import plant_local_date
from app.live import config
from app.live.models import RunningBatch, TelemetryReading
from app.live.simulator import BatchSimulator


class RunningBatchRegistry:
    def __init__(self):
        self._batches: dict[str, RunningBatch] = {}
        self._simulators: dict[str, BatchSimulator] = {}
        self._history: dict[str, list[TelemetryReading]] = {}
        self._plant_seq: dict[str, int] = {}

    def create(
        self, plant: str, scenario_profile: str, drifting_parameter: str | None, enforce_daily_cap: bool = True,
    ) -> RunningBatch:
        # Counts every status (Running + Completed + Stopped) for today
        # (plant-local/IST, not raw UTC - matches the same calendar day the
        # daily-permanent tagging and dashboard bucketing use), not just
        # currently-active batches - see config.MAX_BATCHES_PER_PLANT_PER_DAY.
        # enforce_daily_cap=False is used by the continuous-demo auto-
        # replenish path (app.live.service.create_random_demo_batch, called
        # from scheduler.py) - this cap exists to stop a HUMAN from
        # spamming manual creation, not to throttle the system's own
        # automatic replacement of a batch that just finished.
        if enforce_daily_cap:
            today = plant_local_date(datetime.now(timezone.utc))
            created_today = sum(
                1 for b in self._batches.values() if b.plant == plant and plant_local_date(b.started_at) == today
            )
            if created_today >= config.MAX_BATCHES_PER_PLANT_PER_DAY:
                raise ValueError(
                    f"Daily batch limit ({config.MAX_BATCHES_PER_PLANT_PER_DAY}) reached for '{plant}' - "
                    'delete a completed/stopped batch or try again tomorrow.'
                )

        if scenario_profile != 'Normal' and drifting_parameter is None:
            drifting_parameter = config.DEFAULT_DRIFTING_PARAMETER

        plant_code = plant[:3].upper()
        seq = self._plant_seq.get(plant_code, 0) + 1
        self._plant_seq[plant_code] = seq
        running_batch_id = f'RUN-{plant_code}-{seq:03d}'

        simulator = BatchSimulator(running_batch_id, scenario_profile, drifting_parameter)
        batch = RunningBatch(
            running_batch_id=running_batch_id,
            plant=plant,
            product='Paracetamol 500mg',
            status='Running',
            scenario_profile=scenario_profile,
            drifting_parameter=drifting_parameter,
            phase='dispensing',
            started_at=datetime.now(timezone.utc),
            elapsed_minutes=0,
            target_duration_minutes=simulator.target_duration_minutes(),
        )
        self._batches[running_batch_id] = batch
        self._simulators[running_batch_id] = simulator
        self._history[running_batch_id] = []

        # Instantly pre-fill the first config.PREFILL_MINUTES of history (same
        # simulator math tick_all() would apply minute-by-minute over real
        # time, just run synchronously in one pass) - so KPI Prediction and
        # Process Monitoring's forecast have a full 30-minute window (and
        # something to show) from the very first read after creation,
        # instead of a several-minute real-time wait. Confidence still
        # honestly reads Low this early (see kpi_prediction_agent's
        # _evidence_ceiling) - this skips the WAIT, not the batch's actual
        # progress; ticking continues normally from here on.
        prefill_t = min(config.PREFILL_MINUTES, batch.target_duration_minutes)
        for t in range(0, prefill_t + 1):
            self._append_reading(batch, simulator, t)
        return batch

    def _append_reading(self, batch: RunningBatch, simulator: BatchSimulator, t: int) -> None:
        reading = simulator.reading_at(t)
        batch.phase = reading.phase
        batch.elapsed_minutes = t
        self._history[batch.running_batch_id].append(reading)

    def tick_all(self) -> list[str]:
        newly_completed: list[str] = []
        for batch in list(self._batches.values()):
            if batch.status != 'Running':
                continue
            simulator = self._simulators[batch.running_batch_id]
            next_t = batch.elapsed_minutes + config.SIMULATED_MINUTES_PER_TICK
            if next_t >= batch.target_duration_minutes:
                self._append_reading(batch, simulator, batch.target_duration_minutes)
                batch.status = 'Completed'
                batch.terminal_at = datetime.now(timezone.utc)
                newly_completed.append(batch.running_batch_id)
            else:
                self._append_reading(batch, simulator, next_t)
        return newly_completed

    def list_batches(self) -> list[RunningBatch]:
        return list(self._batches.values())

    def get(self, running_batch_id: str) -> RunningBatch | None:
        return self._batches.get(running_batch_id)

    def get_history(self, running_batch_id: str) -> list[TelemetryReading]:
        return self._history.get(running_batch_id, [])

    def stop(self, running_batch_id: str) -> RunningBatch | None:
        batch = self._batches.get(running_batch_id)
        if batch is not None and batch.status == 'Running':
            batch.status = 'Stopped'
            batch.terminal_at = datetime.now(timezone.utc)
        return batch

    def remove(self, running_batch_id: str) -> None:
        # _plant_seq is deliberately NOT touched - the per-plant counter must
        # keep monotonically increasing even after a batch is deleted, so a
        # newly created batch never reuses a deleted one's running_batch_id.
        self._batches.pop(running_batch_id, None)
        self._simulators.pop(running_batch_id, None)
        self._history.pop(running_batch_id, None)


running_batch_registry = RunningBatchRegistry()
