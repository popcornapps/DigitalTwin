"""Single shared lookup for "what did the golden batch actually do" - used
by both deviation_agent.py (process parameter comparison) and
kpi_prediction_agent.py (final-KPI comparison and root-cause deviation
scoring), so all three comparisons on the live pages read from the exact
same real PAR-GOLDEN data instead of each having its own idea of "golden"
(a real timeseries lookup in one case, a computed zero-deviation constant in
another, hardcoded phase-formula curves in a third - which is what this
replaces).

Deliberately its own small module rather than one agent importing directly
from the other, so deviation_agent.py and kpi_prediction_agent.py don't
depend on each other - both depend on this instead.

Reads app_state.timeseries_df / app_state.batch_kpis_df (Postgres-backed,
see backend/app/state.py) - the same real batch_timeseries/batch_kpis rows
Process Monitoring and Golden Batch already read for this same batch.
"""
from app.state import app_state

GOLDEN_BATCH_ID = 'PAR-GOLDEN'

_golden_ts_cache = None
_golden_kpis_cache: dict | None = None


def golden_timeseries():
    global _golden_ts_cache
    if _golden_ts_cache is None:
        _golden_ts_cache = app_state.timeseries_df[
            app_state.timeseries_df['batch_id'] == GOLDEN_BATCH_ID
        ].set_index('elapsed_minutes')
    return _golden_ts_cache


def golden_value_at(key: str, elapsed_minutes: int) -> float:
    """PAR-GOLDEN's actual recorded value for `key` at `elapsed_minutes` -
    clamped to PAR-GOLDEN's own recorded range at the edges, since a running
    batch can be observed at a minute PAR-GOLDEN's own (shorter or longer)
    duration doesn't cover."""
    golden = golden_timeseries()
    if elapsed_minutes in golden.index:
        return float(golden.loc[elapsed_minutes, key])
    clamped = min(max(elapsed_minutes, golden.index.min()), golden.index.max())
    return float(golden.loc[clamped, key])


def golden_final_kpis() -> dict:
    """PAR-GOLDEN's actual recorded final-batch KPIs (batch_kpis table) -
    the comparison target for kpi_prediction_agent.py's final-KPI deviation.
    Key names match the model manifest's target_columns
    (yield_pct_final, quality_score_pct_final, sec_kwh_per_kg_final,
    oee_pct_final, total_energy_kwh_final) so callers can look up by
    target_col directly, same as before."""
    global _golden_kpis_cache
    if _golden_kpis_cache is None:
        row = app_state.batch_kpis_df.loc[GOLDEN_BATCH_ID]
        _golden_kpis_cache = {
            'yield_pct_final': float(row['yield_pct']),
            'quality_score_pct_final': float(row['quality_score_pct']),
            'sec_kwh_per_kg_final': float(row['sec_kwh_per_kg']),
            'oee_pct_final': float(row['oee_pct']),
            'total_energy_kwh_final': float(row['total_energy_kwh']),
        }
    return _golden_kpis_cache
