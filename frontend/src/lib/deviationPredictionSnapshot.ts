// Real snapshot pulled from the trained Random Forest model (models/paracetamol_random_forest.joblib)
// against actual generated batch data - not a hand-authored mock. Regenerate with:
//   .venv/bin/python scripts/export-ui-snapshot/export_snapshot.py

export interface DeviationParameter {
  key: string;
  label: string;
  unit: string;
  current: number;
  predicted30Min: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  lowerLimit: number;
  upperLimit: number;
  alertLevel: 'Normal' | 'Warning' | 'Critical' | 'Not Applicable';
  applicable: boolean;
}

export interface DeviationPredictionSnapshot {
  batchId: string;
  plant: string;
  product: string;
  elapsedMinutes: number;
  horizonMinutes: number;
  batchDurationMinutes: number;
  groundTruthScenario: string;
  groundTruthSeverity: string;
  parameters: DeviationParameter[];
}

export const deviationPredictionSnapshot: DeviationPredictionSnapshot = {
  "batchId": "PAR-081",
  "plant": "Chennai Plant",
  "product": "Paracetamol 500mg",
  "elapsedMinutes": 228,
  "horizonMinutes": 30,
  "batchDurationMinutes": 393,
  "groundTruthScenario": "Temperature_HeaterFault",
  "groundTruthSeverity": "Warning",
  "parameters": [
    {
      "key": "temperature",
      "label": "Temperature",
      "unit": "\u00b0C",
      "current": 68.1,
      "predicted30Min": 67.01,
      "ciLow": 65.0,
      "ciHigh": 68.1,
      "lowerLimit": 63.0,
      "upperLimit": 67.0,
      "alertLevel": "Warning",
      "applicable": true
    },
    {
      "key": "process_pressure",
      "label": "Process Pressure",
      "unit": "bar",
      "current": 1.22,
      "predicted30Min": 1.19,
      "ciLow": 1.16,
      "ciHigh": 1.23,
      "lowerLimit": 1.1,
      "upperLimit": 1.3,
      "alertLevel": "Normal",
      "applicable": true
    },
    {
      "key": "flow_rate",
      "label": "Flow Rate",
      "unit": "L/min",
      "current": 49.2,
      "predicted30Min": 48.38,
      "ciLow": 46.6,
      "ciHigh": 49.5,
      "lowerLimit": 45.0,
      "upperLimit": 52.0,
      "alertLevel": "Normal",
      "applicable": true
    },
    {
      "key": "agitator_rpm",
      "label": "Agitator RPM",
      "unit": "RPM",
      "current": 0.0,
      "predicted30Min": null,
      "ciLow": null,
      "ciHigh": null,
      "lowerLimit": 20.0,
      "upperLimit": 24.0,
      "alertLevel": "Not Applicable",
      "applicable": false
    }
  ]
};
