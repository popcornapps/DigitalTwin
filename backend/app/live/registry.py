"""In-memory store of all running batches and their telemetry history. Lives
only for the FastAPI process's lifetime - a running batch's history is not
persisted anywhere and does not touch paracetamol_batches.csv/timeseries.csv
(that dataset is the ML training ground truth and stays exactly as generated;
these are ephemeral simulation runs, not new training data).
"""
from datetime import datetime, timezone

from app.live import config
from app.live.models import RunningBatch, TelemetryReading
from app.live.simulator import BatchSimulator


class RunningBatchRegistry:
    def __init__(self):
        self._batches: dict[str, RunningBatch] = {}
        self._simulators: dict[str, BatchSimulator] = {}
        self._history: dict[str, list[TelemetryReading]] = {}
        self._plant_seq: dict[str, int] = {}

    def create(self, plant: str, scenario_profile: str, drifting_parameter: str | None) -> RunningBatch:
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
        self._append_reading(batch, simulator, 0)
        return batch

    def _append_reading(self, batch: RunningBatch, simulator: BatchSimulator, t: int) -> None:
        reading = simulator.reading_at(t)
        batch.phase = reading.phase
        batch.elapsed_minutes = t
        self._history[batch.running_batch_id].append(reading)

    def tick_all(self) -> None:
        for batch in list(self._batches.values()):
            if batch.status != 'Running':
                continue
            simulator = self._simulators[batch.running_batch_id]
            next_t = batch.elapsed_minutes + config.SIMULATED_MINUTES_PER_TICK
            if next_t >= batch.target_duration_minutes:
                self._append_reading(batch, simulator, batch.target_duration_minutes)
                batch.status = 'Completed'
            else:
                self._append_reading(batch, simulator, next_t)

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
        return batch


running_batch_registry = RunningBatchRegistry()
