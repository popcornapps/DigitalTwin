from fastapi import APIRouter, HTTPException

from app.schemas.batch import BatchSummary
from app.schemas.timeline import TimelineResponse
from app.services import data_service
from app.state import app_state

router = APIRouter(prefix='/api/batches', tags=['batches'])


@router.get('', response_model=list[BatchSummary])
def list_batches():
    return data_service.get_batch_list(app_state)


@router.get('/{batch_id}/timeline', response_model=TimelineResponse)
def get_batch_timeline(batch_id: str):
    timeline = data_service.get_timeline(app_state, batch_id)
    if timeline is None:
        raise HTTPException(status_code=404, detail=f"'{batch_id}' is not a known test batch")
    return timeline
