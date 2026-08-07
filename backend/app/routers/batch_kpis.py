from datetime import date

from fastapi import APIRouter, HTTPException, Query

from app.config import PLANT_PERIOD_GROUP_BY_VALUES
from app.schemas.batch_kpis import BatchKPIs, PlantKpiRollup, PlantPeriodKpi, PlantPeriodKpiList
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


@router.get('/plant-period-kpis', response_model=PlantPeriodKpiList)
def get_plant_period_kpis(
    plant: str = Query(...),
    group_by: str = Query(...),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
):
    if group_by not in PLANT_PERIOD_GROUP_BY_VALUES:
        raise HTTPException(
            status_code=400,
            detail=f"group_by must be one of {PLANT_PERIOD_GROUP_BY_VALUES}, got '{group_by}'",
        )
    result = data_service.get_plant_period_kpis(app_state, plant, group_by, start_date=start_date, end_date=end_date)
    if result is None:
        raise HTTPException(status_code=404, detail=f"No batches found for plant '{plant}'")
    return result


@router.get('/plant-current-period-kpi', response_model=PlantPeriodKpi)
def get_plant_current_period_kpi(plant: str = Query(...), group_by: str = Query(...)):
    if group_by not in PLANT_PERIOD_GROUP_BY_VALUES:
        raise HTTPException(
            status_code=400,
            detail=f"group_by must be one of {PLANT_PERIOD_GROUP_BY_VALUES}, got '{group_by}'",
        )
    result = data_service.get_plant_current_period_kpi(app_state, plant, group_by)
    if result is None:
        raise HTTPException(status_code=404, detail=f"No batches found for plant '{plant}'")
    return result


@router.get('/manifest')
def get_manifest():
    return data_service.get_batch_kpis_manifest()


# Must stay after /rollup, /plant-period-kpis, /plant-current-period-kpi, and
# /manifest - a bare /{batch_id} registered first would swallow those literal
# paths as batch_id values.
@router.get('/{batch_id}', response_model=BatchKPIs)
def get_batch_kpis(batch_id: str):
    kpis = data_service.get_batch_kpis(app_state, batch_id)
    if kpis is None:
        raise HTTPException(status_code=404, detail=f"'{batch_id}' is not a known batch")
    return kpis
