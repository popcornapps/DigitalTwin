import json

import joblib
import pandas as pd

from app import config


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

        self.batches_df = pd.read_csv(config.BATCHES_CSV).set_index('batch_id')
        self.timeseries_df = pd.read_csv(config.TIMESERIES_CSV)
        self.batch_kpis_df = pd.read_csv(config.BATCH_KPIS_CSV).set_index('batch_id')
        self.golden_envelope_df = pd.read_csv(config.GOLDEN_ENVELOPE_CSV).set_index('elapsed_minutes')

        needed_columns = ['batch_id', 'split', 'elapsed_minutes'] + self.feature_columns + self.target_columns
        self.training_df = pd.read_csv(config.TRAINING_DATASET_CSV, usecols=needed_columns)
        self.test_batch_ids = set(self.training_df.loc[self.training_df['split'] == 'test', 'batch_id'].unique())

        param_config = pd.read_csv(config.PARAMETER_CONFIG_CSV).set_index('parameter')
        self.parameter_limits = {
            key: (float(param_config.loc[name, 'lower_limit']), float(param_config.loc[name, 'upper_limit']))
            for key, name in config.PARAMETER_CONFIG_NAMES.items()
        }

    def ground_truth_severity(self, batch_id: str) -> str:
        severity = self.batches_df.loc[batch_id, 'deviation_severity']
        return 'Normal' if pd.isna(severity) or severity == 'None' else severity

    def valid_time_range(self, batch_id: str) -> tuple[int, int]:
        duration = int(self.batches_df.loc[batch_id, 'batch_duration_minutes'])
        return config.DRYING_WINDOW_START_MINUTES, duration - config.DRYING_WINDOW_END_BUFFER_MINUTES - config.HORIZON_MINUTES


app_state = AppState()
