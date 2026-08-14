from pydantic import BaseModel


class KpiContributingParameterOut(BaseModel):
    """Level 1 - observed parameter deviation: a raw sensor reading vs its
    Golden Batch value, plus how much this KPI's approved formula weighs it
    (formula_weight, copied from kpi_prediction_agent.KPI_PARAMETER_WEIGHTS)
    and a plain-language impact_level (High/Medium/Low) derived from
    deviation_score alone - never invented or re-scored by the LLM."""
    key: str
    label: str
    unit: str
    current: float
    golden: float
    deviation: float
    direction: str  # 'up' | 'down' | 'stable'
    deviation_score: float
    formula_weight: float
    impact_level: str  # 'High' | 'Medium' | 'Low'


class KpiFormulaParameterOut(BaseModel):
    """One parameter as it appears inside a formula component below -
    weight_within_component is that component's own coefficients
    renormalized to sum to 1 (display only - the real KPI math always uses
    the raw coefficients in kpi_prediction_agent.KPI_PARAMETER_WEIGHTS)."""
    key: str
    label: str
    unit: str
    current: float
    golden: float
    deviation: float
    direction: str
    deviation_score: float
    weight_within_component: float


class KpiFormulaComponentOut(BaseModel):
    """Level 2 - one link in the formula chain from parameter deviation to
    this KPI (e.g. Yield's 'Process Stability' or 'Agitator Consistency') -
    computed directly from the approved KPI formula
    (kpi_prediction_agent.KPI_COMPONENT_BUILDERS), not synthesized by the
    LLM. contribution_estimate is an explanatory reconstruction of this
    component's share of the KPI's total estimated deviation - None when the
    component has no computable share (e.g. Total Energy's Duration
    Extension, OEE's Availability/Performance - see `note`)."""
    name: str
    contribution_estimate: float | None
    parameters: list[KpiFormulaParameterOut]
    note: str | None


class KpiPredictionOut(BaseModel):
    key: str  # 'yield_pct' | 'quality_score_pct' | 'sec_kwh_per_kg' | 'oee_pct' | 'total_energy_kwh'
    label: str
    unit: str
    # --- Model-predicted KPI: the ML model's own regression output ---
    predicted_final: float
    golden_final: float
    deviation_pct: float
    status: str  # 'normal' | 'warning' | 'critical'
    confidence: str  # 'High' | 'Medium' | 'Low'
    confidence_reason: str  # plain-language explanation of why confidence is at this level - see kpi_prediction_agent._confidence_reason
    # --- Level 1: observed parameter deviation ---
    contributing_parameters: list[KpiContributingParameterOut]
    # True when none of this KPI's tracked parameters cleared the
    # "real contributor" threshold - the deviation likely comes from an
    # unattributable part of the formula instead (see kpi_formula_note).
    weak_signal: bool
    # --- Level 2: formula-derived KPI components ---
    formula_components: list[KpiFormulaComponentOut]
    # Plain-language note for the parts of this KPI's formula that can't be
    # traced to any process parameter (e.g. OEE's Availability/Performance) -
    # None for KPIs with no such gap.
    kpi_formula_note: str | None
    # --- Level 3: AI interpretation/recommendation (app.live.kpi_llm_agent) -
    # Static mode uses a deterministic fallback template built from levels 1
    # and 2 above, Agent LLM mode uses a real Azure OpenAI call constrained
    # to the same evidence, with the same fallback on any failure.
    # reasoning_source ('static' | 'llm') reports which one actually
    # produced this text. Neither path invents a parameter, component, or
    # numeric value beyond what levels 1/2 already computed. ---
    kpi_summary: str
    deviation_explanation: str
    urgency: str
    recommended_action: str
    operational_impact: str
    reasoning_source: str


class KpiHistoryPointOut(BaseModel):
    """One raw telemetry reading, for the small multi-row history table
    showing all 12 process parameters - not just whichever 1-3 are currently
    flagged as top contributors above."""
    elapsed_minutes: int
    temperature: float
    process_pressure: float
    flow_rate: float
    agitator_rpm: float
    inlet_air_humidity: float
    exhaust_air_temp: float
    filter_differential_pressure: float
    shaker_vibration_frequency: float
    product_bed_temp: float
    chamber_differential_pressure: float
    ahu_damper_position: float
    compressed_air_pressure: float


class KpiPredictionResponse(BaseModel):
    running_batch_id: str
    elapsed_minutes: int
    kpis: list[KpiPredictionOut]
    # Newest-first, capped to the last HISTORY_MINUTES readings (see
    # kpi_prediction_agent.py) - same convention as Process Monitoring's own
    # History table.
    history: list[KpiHistoryPointOut]
