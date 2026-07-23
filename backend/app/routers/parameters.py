from fastapi import APIRouter

from app.config import ALL_PARAMETER_KEYS, PARAMETER_LABELS, PARAMETER_UNITS
from app.state import app_state

router = APIRouter(prefix='/api/parameters', tags=['parameters'])


@router.get('/config')
def get_parameter_config():
    return [
        {
            'key': key,
            'label': PARAMETER_LABELS[key],
            'unit': PARAMETER_UNITS[key],
            'lower_limit': app_state.parameter_limits[key][0],
            'upper_limit': app_state.parameter_limits[key][1],
        }
        for key in ALL_PARAMETER_KEYS
    ]


@router.get('/envelope')
def get_golden_envelope():
    """Per-minute deviation envelope derived from real Normal historical
    batches vs the golden batch (see scripts/generate-golden-envelope) - the
    dynamic Golden(t) +/- Margin(t) reference that replaces the fixed
    parameter_config band for deviation status in Process Monitoring."""
    df = app_state.golden_envelope_df.reset_index()
    return df.to_dict(orient='records')
