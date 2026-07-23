from fastapi import APIRouter, HTTPException

from app.live import service
from app.live.models import RunningBatch
from app.schemas.live_batch import (
    CreateRunningBatchRequest,
    LiveParameterPredictionOut,
    LivePredictionOut,
    RunningBatchSummary,
    RunningBatchTelemetryResponse,
    TelemetryReadingOut,
)

router = APIRouter(prefix='/api/live-batches', tags=['live-batches'])


def _to_summary(batch: RunningBatch) -> RunningBatchSummary:
    return RunningBatchSummary(
        running_batch_id=batch.running_batch_id,
        plant=batch.plant,
        product=batch.product,
        status=batch.status,
        scenario_profile=batch.scenario_profile,
        drifting_parameter=batch.drifting_parameter,
        phase=batch.phase,
        started_at=batch.started_at,
        elapsed_minutes=batch.elapsed_minutes,
        target_duration_minutes=batch.target_duration_minutes,
    )


@router.post('', response_model=RunningBatchSummary)
def create_batch(req: CreateRunningBatchRequest):
    batch = service.create_running_batch(req.plant, req.scenario_profile, req.drifting_parameter)
    return _to_summary(batch)


@router.get('', response_model=list[RunningBatchSummary])
def list_batches():
    return [_to_summary(b) for b in service.list_running_batches()]


@router.get('/{running_batch_id}', response_model=RunningBatchSummary)
def get_batch(running_batch_id: str):
    batch = service.get_running_batch(running_batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail=f"'{running_batch_id}' is not a known running batch")
    return _to_summary(batch)


@router.get('/{running_batch_id}/telemetry', response_model=RunningBatchTelemetryResponse)
def get_telemetry(running_batch_id: str):
    batch = service.get_running_batch(running_batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail=f"'{running_batch_id}' is not a known running batch")
    history = service.get_telemetry_history(running_batch_id)
    points = [
        TelemetryReadingOut(
            elapsed_minutes=r.elapsed_minutes,
            recorded_at=r.recorded_at,
            phase=r.phase,
            temperature=r.temperature,
            process_pressure=r.process_pressure,
            flow_rate=r.flow_rate,
            agitator_rpm=r.agitator_rpm,
        )
        for r in history
    ]

    prediction = None
    if batch.latest_prediction is not None:
        prediction = LivePredictionOut(
            horizon_minutes=batch.latest_prediction.horizon_minutes,
            computed_at_elapsed_minutes=batch.latest_prediction.computed_at_elapsed_minutes,
            parameters=[
                LiveParameterPredictionOut(
                    key=p.key,
                    predicted=p.predicted,
                    ci_low=p.ci_low,
                    ci_high=p.ci_high,
                    alert_level=p.alert_level,
                )
                for p in batch.latest_prediction.parameters
            ],
        )

    return RunningBatchTelemetryResponse(batch=_to_summary(batch), points=points, prediction=prediction)


@router.post('/{running_batch_id}/stop', response_model=RunningBatchSummary)
def stop_batch(running_batch_id: str):
    batch = service.stop_running_batch(running_batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail=f"'{running_batch_id}' is not a known running batch")
    return _to_summary(batch)
