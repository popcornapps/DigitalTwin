import json

import joblib
import pandas as pd

from app import config
from app.db import get_connection


class AppState:
    def __init__(self):
        self.model = None
        self.manifest: dict = {}
        self.feature_columns: list[str] = []
        self.target_columns: list[str] = []
        self.batches_df: pd.DataFrame | None = None
        self.timeseries_df: pd.DataFrame | None = None
        self.training_df: pd.DataFrame | None = None
        self.batch_kpis_df: pd.DataFrame | None = None
        self.golden_envelope_df: pd.DataFrame | None = None
        self.parameter_limits: dict[str, tuple[float, float]] = {}
        self.test_batch_ids: set[str] = set()

    def load(self):
        self.manifest = json.loads(config.MANIFEST_PATH.read_text())
        self.feature_columns = self.manifest['feature_columns']
        self.target_columns = self.manifest['target_columns']
        self.model = joblib.load(config.MODEL_PATH)

        # Table 2 of the incremental Postgres cutover (see
        # scripts/postgres-migration/) - was pd.read_csv(config.BATCHES_CSV).
        # Two things are normalized right after the read so this DataFrame
        # stays bit-for-bit identical to the CSV path's output:
        #  1) pandas.read_csv's default NA-sniffing silently turned the CSV's
        #     literal "None" text into real NaN for deviation_scenario/
        #     deviation_severity - several call sites (ground_truth_severity,
        #     _ground_truth_scenario) already depend on pd.isna() for this,
        #     so Postgres's faithfully-stored "None" text has to become NaN
        #     again here, not stay as the literal string.
        #  2) batch_start_datetime is read back as a tz-aware Timestamp, but
        #     data_service.py does str(row['batch_start_datetime']) straight
        #     into an API response - reformatted back to the exact original
        #     "...T19:00:00.000Z" text so that response is unchanged.
        with get_connection() as conn:
            self.batches_df = pd.read_sql(
                'SELECT batch_id, plant, is_golden_batch, batch_start_datetime, batch_duration_minutes, '
                'deviation_scenario, deviation_severity, theoretical_output_kg, actual_output_kg, '
                'energy_kwh, assay_pct FROM batches',
                conn,
            ).set_index('batch_id')
        self.batches_df['deviation_scenario'] = self.batches_df['deviation_scenario'].replace('None', pd.NA)
        self.batches_df['deviation_severity'] = self.batches_df['deviation_severity'].replace('None', pd.NA)
        self.batches_df['batch_start_datetime'] = self.batches_df['batch_start_datetime'].dt.strftime(
            '%Y-%m-%dT%H:%M:%S.000Z'
        )

        # Table 3 of the incremental Postgres cutover - was
        # pd.read_csv(config.TIMESERIES_CSV). No CSV-parsing quirks to
        # replicate here (unlike batches above): every consumer
        # (data_service.get_timeline, deviation_agent._golden_value_at)
        # already explicitly casts to float()/int() before use, and neither
        # depends on this DataFrame's row order or index.
        #
        # Joined with batch_support_timeseries (the 8 parameters added in
        # scripts/generate-support-parameters/) so every consumer of this
        # DataFrame - golden_reference.golden_value_at() in particular - sees
        # all 12 parameters through the same lookup, with no code change of
        # its own. INNER JOIN: a handful of batches predate the support table
        # (see generate_support_parameters.py's docstring) and are correctly
        # excluded from anything reading this DataFrame, same as before.
        with get_connection() as conn:
            self.timeseries_df = pd.read_sql(
                'SELECT t.batch_id, t.elapsed_minutes, t.temperature, t.process_pressure, t.flow_rate, t.agitator_rpm, '
                's.inlet_air_humidity_pct AS inlet_air_humidity, s.exhaust_air_temp_c AS exhaust_air_temp, '
                's.filter_differential_pressure_mbar AS filter_differential_pressure, '
                's.shaker_vibration_frequency_hz AS shaker_vibration_frequency, '
                's.product_bed_temp_c AS product_bed_temp, '
                's.chamber_differential_pressure_mbar AS chamber_differential_pressure, '
                's.ahu_damper_position_pct AS ahu_damper_position, '
                's.compressed_air_pressure_bar AS compressed_air_pressure '
                'FROM batch_timeseries t '
                'JOIN batch_support_timeseries s ON s.batch_id = t.batch_id AND s.elapsed_minutes = t.elapsed_minutes',
                conn,
            )
        # Table 4 - was pd.read_csv(config.BATCH_KPIS_CSV). No gotchas:
        # _build_batch_kpis already explicitly casts every field with
        # float()/str(), and its one nullable column (fault_onset_elapsed_minutes)
        # is a genuinely blank CSV cell (real NaN both before and after), not
        # the "None"-text case batches.csv has.
        with get_connection() as conn:
            self.batch_kpis_df = pd.read_sql('SELECT * FROM batch_kpis', conn).set_index('batch_id')

        # Table 5 - was pd.read_csv(config.GOLDEN_ENVELOPE_CSV). All 8 offset
        # columns are floats, no nullable/text columns at all.
        with get_connection() as conn:
            self.golden_envelope_df = pd.read_sql('SELECT * FROM golden_envelope', conn).set_index('elapsed_minutes')

        # Table 6 - was pd.read_csv(config.TRAINING_DATASET_CSV, usecols=needed_columns).
        # get_feature_row/model_service.predict both look up columns by name
        # (feature_row[col] for col in state.feature_columns), never by
        # position, so column order here doesn't need to match the CSV's -
        # only that every needed column is present with the right values.
        # De-duplicated with dict.fromkeys() (order-preserving) because
        # feature_columns already includes 'elapsed_minutes' as its first
        # entry - pandas' usecols= silently tolerated that repeat (it's just
        # a filter set), but a literal SQL column list doesn't: an unde-duped
        # SELECT would ask for elapsed_minutes twice and hand back two
        # identically-named columns, breaking every == comparison downstream.
        needed_columns = list(dict.fromkeys(
            ['batch_id', 'split', 'elapsed_minutes'] + self.feature_columns + self.target_columns
        ))
        with get_connection() as conn:
            self.training_df = pd.read_sql(
                f"SELECT {', '.join(needed_columns)} FROM {config.TRAINING_DATASET_TABLE_NAME}", conn
            )
        self.test_batch_ids = set(self.training_df.loc[self.training_df['split'] == 'test', 'batch_id'].unique())

        # Table 1 of the incremental Postgres cutover (see
        # scripts/postgres-migration/) - was pd.read_csv(config.PARAMETER_CONFIG_CSV).
        # Only the 4 parameters in PARAMETER_CONFIG_NAMES are fetched, matching
        # the CSV path's behavior exactly (the CSV's 5th row, "Assay", was
        # already unused here - see PARAMETER_CONFIG_NAMES).
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute(
                'SELECT parameter, lower_limit, upper_limit FROM parameters WHERE parameter = ANY(%s)',
                (list(config.PARAMETER_CONFIG_NAMES.values()),),
            )
            limits_by_name = {name: (lower, upper) for name, lower, upper in cur.fetchall()}
        self.parameter_limits = {
            key: (float(limits_by_name[name][0]), float(limits_by_name[name][1]))
            for key, name in config.PARAMETER_CONFIG_NAMES.items()
        }

    def ground_truth_severity(self, batch_id: str) -> str:
        severity = self.batches_df.loc[batch_id, 'deviation_severity']
        return 'Normal' if pd.isna(severity) or severity == 'None' else severity

    def valid_time_range(self, batch_id: str) -> tuple[int, int]:
        duration = int(self.batches_df.loc[batch_id, 'batch_duration_minutes'])
        return config.DRYING_WINDOW_START_MINUTES, duration - config.DRYING_WINDOW_END_BUFFER_MINUTES - config.HORIZON_MINUTES


app_state = AppState()
