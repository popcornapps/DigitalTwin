"""One-time backfill of data/live_alerts_store.json into the new `alerts`
table, so the AI Review Desk's history isn't wiped out by the cutover.

Run once, before alert_registry.py is switched over to Postgres:
    .venv/bin/python backend/scripts/postgres-migration/import_alerts.py
"""
import json
import os
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[2]
STORE_PATH = BACKEND_ROOT / 'data' / 'live_alerts_store.json'

load_dotenv(BACKEND_ROOT / '.env')
DATABASE_URL = os.environ.get('DATABASE_URL')

COLUMNS = [
    'alert_id', 'running_batch_id', 'plant', 'parameter', 'trigger_type', 'severity',
    'detected_at_elapsed_minutes', 'created_at', 'observation', 'predicted_observation',
    'time_to_breach_minutes', 'confidence', 'likely_root_cause', 'recommended_action',
    'status', 'resolved_at_elapsed_minutes', 'resolved_at',
    'alert_summary', 'trigger_explanation', 'urgency', 'operational_impact',
    'root_cause_confidence_pct', 'root_cause_confidence_level', 'root_cause_confidence_explanation',
    'recommendation_confidence_pct', 'recommendation_confidence_level', 'recommendation_confidence_explanation',
    'reasoning_source', 'human_decision', 'human_decision_at', 'reasoning_fingerprint',
]


def main() -> None:
    if not DATABASE_URL:
        sys.exit('DATABASE_URL not set - add it to backend/.env first.')
    if not STORE_PATH.exists():
        print(f'{STORE_PATH} does not exist - nothing to import, starting empty.')
        return

    alerts = json.loads(STORE_PATH.read_text())
    print(f'Found {len(alerts)} alerts in {STORE_PATH.name}')

    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute('TRUNCATE TABLE alerts;')
                placeholders = ', '.join(['%s'] * len(COLUMNS))
                col_list = ', '.join(COLUMNS)
                insert_sql = f'INSERT INTO alerts ({col_list}) VALUES ({placeholders})'
                for a in alerts:
                    values = []
                    for c in COLUMNS:
                        v = a.get(c)
                        if c == 'reasoning_fingerprint' and v is not None:
                            v = psycopg2.extras.Json(v)
                        values.append(v)
                    cur.execute(insert_sql, values)
                cur.execute('SELECT COUNT(*) FROM alerts;')
                count = cur.fetchone()[0]
        print(f'Imported {count} alerts into Postgres.')
    except Exception:
        conn.rollback()
        print('Import FAILED - rolled back.', file=sys.stderr)
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    main()
