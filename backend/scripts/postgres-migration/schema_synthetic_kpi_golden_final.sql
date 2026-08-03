-- PharmaTwin: synthetic_kpi_golden_final - replaces
-- data/synthetic_kpi_golden_final.json. Single-row reference: the synthetic
-- golden batch's final KPI targets, used by kpi_prediction_agent.py to
-- compute each running batch's predicted deviation_pct. Read once at first
-- use and cached in-process (_golden_cache), same as before - just sourced
-- from Postgres instead of a JSON file.

BEGIN;

CREATE TABLE synthetic_kpi_golden_final (
    yield_pct_final          double precision NOT NULL,
    quality_score_pct_final  double precision NOT NULL,
    sec_kwh_per_kg_final     double precision NOT NULL,
    oee_pct_final            double precision NOT NULL,
    total_energy_kwh_final   double precision NOT NULL
);

INSERT INTO synthetic_kpi_golden_final (
    yield_pct_final, quality_score_pct_final, sec_kwh_per_kg_final, oee_pct_final, total_energy_kwh_final
) VALUES (
    100.0, 100.0, 1.6107, 94.0, 241.6
);

COMMIT;
