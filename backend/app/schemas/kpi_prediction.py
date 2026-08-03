from pydantic import BaseModel


class KpiContributingParameterOut(BaseModel):
    key: str
    label: str
    unit: str
    current: float
    golden: float
    deviation: float
    direction: str  # 'up' | 'down' | 'stable'
    deviation_score: float


class KpiPredictionOut(BaseModel):
    key: str  # 'yield_pct' | 'quality_score_pct' | 'sec_kwh_per_kg' | 'oee_pct' | 'total_energy_kwh'
    label: str
    unit: str
    predicted_final: float
    golden_final: float
    deviation_pct: float
    status: str  # 'normal' | 'warning' | 'critical'
    confidence: str  # 'High' | 'Medium' | 'Low'
    confidence_reason: str  # plain-language explanation of why confidence is at this level - see kpi_prediction_agent._confidence_reason
    contributing_parameters: list[KpiContributingParameterOut]
    # LLM reasoning layer output (app.live.kpi_llm_agent) - Static mode uses a
    # deterministic fallback template, Agent LLM mode uses a real Azure
    # OpenAI call with the same fallback on any failure. reasoning_source
    # ('static' | 'llm') reports which one actually produced this text.
    kpi_summary: str
    deviation_explanation: str
    urgency: str
    recommended_action: str
    operational_impact: str
    reasoning_source: str


class KpiHistoryPointOut(BaseModel):
    """One raw telemetry reading, for the small multi-row history table
    showing all 4 process parameters - not just whichever 1-3 are currently
    flagged as top contributors above."""
    elapsed_minutes: int
    temperature: float
    process_pressure: float
    flow_rate: float
    agitator_rpm: float


class KpiPredictionResponse(BaseModel):
    running_batch_id: str
    elapsed_minutes: int
    kpis: list[KpiPredictionOut]
    # Newest-first, capped to the last HISTORY_MINUTES readings (see
    # kpi_prediction_agent.py) - same convention as Process Monitoring's own
    # History table.
    history: list[KpiHistoryPointOut]
