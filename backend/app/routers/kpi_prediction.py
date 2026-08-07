from fastapi import APIRouter, HTTPException

from app.live import kpi_prediction_agent, service
from app.schemas.kpi_prediction import KpiPredictionResponse

router = APIRouter(prefix='/api/kpi-prediction', tags=['kpi-prediction'])


@router.get('/{running_batch_id}', response_model=KpiPredictionResponse)
def get_kpi_prediction(running_batch_id: str):
    batch = service.get_running_batch(running_batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail=f"'{running_batch_id}' is not a known running batch")

    result = kpi_prediction_agent.predict_kpis(running_batch_id, batch.elapsed_minutes, batch.plant)
    if result is None:
        raise HTTPException(
            status_code=422,
            detail='Not enough telemetry history yet - the KPI Prediction Agent needs 30+ minutes of readings.',
        )
    return result
