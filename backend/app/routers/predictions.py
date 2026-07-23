from fastapi import APIRouter, HTTPException

from app.config import ALL_PARAMETER_KEYS, DRYING_PARAMETER_KEYS, HORIZON_MINUTES, PARAMETER_LABELS, PARAMETER_UNITS
from app.schemas.prediction import ParameterPrediction, PredictionResponse
from app.services import data_service, model_service
from app.services.alert_service import classify_actual, classify_predicted, correctness
from app.state import app_state

router = APIRouter(prefix='/api/batches', tags=['predictions'])

TARGET_COLUMN = {key: f'{key}_target_30min' for key in ALL_PARAMETER_KEYS}


@router.get('/{batch_id}/predict', response_model=PredictionResponse)
def predict_at(batch_id: str, at: int):
    if batch_id not in app_state.test_batch_ids:
        raise HTTPException(status_code=404, detail=f"'{batch_id}' is not a known test batch")

    min_t, max_t = app_state.valid_time_range(batch_id)
    if not (min_t <= at <= max_t):
        raise HTTPException(
            status_code=400,
            detail=f"elapsed_minutes={at} is outside this batch's valid prediction window "
                   f"({min_t}-{max_t}). Outside this window the golden operating band doesn't "
                   f"apply (dispensing/mixing/cooling phases) or there isn't enough history/future "
                   f"data yet.",
        )

    feature_row = data_service.get_feature_row(app_state, batch_id, at)
    if feature_row is None:
        raise HTTPException(status_code=404, detail=f'No precomputed feature row for {batch_id} at minute {at}')

    model_output = model_service.predict(app_state, feature_row)

    parameters = []
    for key in DRYING_PARAMETER_KEYS:
        lo, hi = app_state.parameter_limits[key]
        target_col = TARGET_COLUMN[key]
        pred = model_output[target_col]
        actual = float(feature_row[target_col])

        predicted_alert = classify_predicted(pred['predicted'], lo, hi, pred['ci_low'], pred['ci_high'])
        actual_alert = classify_actual(actual, lo, hi)

        parameters.append(ParameterPrediction(
            key=key,
            label=PARAMETER_LABELS[key],
            unit=PARAMETER_UNITS[key],
            applicable=True,
            current=float(feature_row[f'{key}_current']),
            predicted=round(pred['predicted'], 2),
            ci_low=round(pred['ci_low'], 2),
            ci_high=round(pred['ci_high'], 2),
            lower_limit=lo,
            upper_limit=hi,
            alert_level=predicted_alert,
            actual=round(actual, 2),
            actual_alert_level=actual_alert,
            error=round(pred['predicted'] - actual, 2),
            correctness=correctness(predicted_alert, actual_alert),
        ))

    rpm_lo, rpm_hi = app_state.parameter_limits['agitator_rpm']
    parameters.append(ParameterPrediction(
        key='agitator_rpm',
        label=PARAMETER_LABELS['agitator_rpm'],
        unit=PARAMETER_UNITS['agitator_rpm'],
        applicable=False,
        current=float(feature_row['agitator_rpm_current']),
        predicted=None,
        ci_low=None,
        ci_high=None,
        lower_limit=rpm_lo,
        upper_limit=rpm_hi,
        alert_level='Not Applicable',
        actual=None,
        actual_alert_level=None,
        error=None,
        correctness=None,
    ))

    return PredictionResponse(batch_id=batch_id, elapsed_minutes=at, horizon_minutes=HORIZON_MINUTES, parameters=parameters)
