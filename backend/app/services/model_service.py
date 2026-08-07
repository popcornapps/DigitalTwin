import numpy as np

from app.state import AppState


def predict(state: AppState, feature_row: dict) -> dict[str, dict[str, float]]:
    """Run the trained model once for a single (batch, minute) feature row.

    Returns, per target column: point estimate plus the 90% interval derived
    from every tree's own prediction - the same confidence calculation
    validated in the deviation-detection and alerting-logic analyses, just
    computed live per request instead of precomputed for the whole test set.
    """
    x = np.array([[feature_row[col] for col in state.feature_columns]])
    point_pred = state.model.predict(x)[0]
    tree_preds = np.stack([tree.predict(x) for tree in state.model.estimators_])[:, 0, :]
    ci_low = np.percentile(tree_preds, 5, axis=0)
    ci_high = np.percentile(tree_preds, 95, axis=0)

    result = {}
    for i, target_col in enumerate(state.target_columns):
        result[target_col] = {
            'predicted': float(point_pred[i]),
            'ci_low': float(ci_low[i]),
            'ci_high': float(ci_high[i]),
        }
    return result
