"""Postgres connection helper for the incremental CSV -> Postgres backend
cutover (see scripts/postgres-migration/). Tables move over one at a time;
this is the one shared connection point every migrated table's loader uses,
so there's a single place to add pooling later if a request-time (not just
startup-time) query ever needs one - today every caller is a one-shot read
during AppState.load(), same as the CSV reads it's replacing.
"""
import os

import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get('DATABASE_URL')


def get_connection():
    if not DATABASE_URL:
        raise RuntimeError(
            'DATABASE_URL is not set - required now that some tables read from Postgres. '
            'Add it to backend/.env.'
        )
    return psycopg2.connect(DATABASE_URL)
