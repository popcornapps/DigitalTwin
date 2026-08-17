from fastapi import APIRouter, HTTPException

from app.live import service
from app.schemas.kpi_prediction import KpiPredictionResponse

router = APIRouter(prefix='/api/kpi-prediction', tags=['kpi-prediction'])


@router.get('/{running_batch_id}', response_model=KpiPredictionResponse)
def get_kpi_prediction(running_batch_id: str):
    """Reads batch.latest_kpi_prediction - the scheduler's own last-computed
    result (see scheduler.py) - rather than calling kpi_prediction_agent.
    predict_kpis() here directly. That used to mean this endpoint could block
    for however long a stale KPI's Agent LLM reasoning call took (many
    seconds) on every single page view/refresh; now it's always an instant
    in-memory read, since all of that work already happens continuously in
    the background regardless of whether anyone's viewing this batch."""
    batch = service.get_running_batch(running_batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail=f"'{running_batch_id}' is not a known running batch")

    result = batch.latest_kpi_prediction
    if result is None:
        raise HTTPException(
            status_code=422,
            detail=(
                'KPI prediction not available yet for this batch - either it needs 30+ minutes of history, '
                'or the background scheduler has not processed its first tick yet (updates every few seconds).'
            ),
        )
    return result
