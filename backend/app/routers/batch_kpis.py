from fastapi import APIRouter, HTTPException, Query

from app.schemas.batch_kpis import BatchKPIs, PlantKpiRollup
from app.services import data_service
from app.state import app_state

router = APIRouter(prefix='/api/batch-kpis', tags=['batch-kpis'])


@router.get('', response_model=list[BatchKPIs])
def list_batch_kpis():
    return data_service.get_batch_kpis_list(app_state)


@router.get('/rollup', response_model=PlantKpiRollup)
def get_plant_rollup(plant: str = Query(...)):
    rollup = data_service.get_plant_kpi_rollup(app_state, plant)
    if rollup is None:
        raise HTTPException(status_code=404, detail=f"No batches found for plant '{plant}'")
    return rollup


@router.get('/manifest')
def get_manifest():
    return data_service.get_batch_kpis_manifest()


# Must stay after /rollup and /manifest - a bare /{batch_id} registered first
# would swallow those two literal paths as batch_id values.
@router.get('/{batch_id}', response_model=BatchKPIs)
def get_batch_kpis(batch_id: str):
    kpis = data_service.get_batch_kpis(app_state, batch_id)
    if kpis is None:
        raise HTTPException(status_code=404, detail=f"'{batch_id}' is not a known batch")
    return kpis
