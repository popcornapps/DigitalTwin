import logging


class SuppressHighFrequencyAccessLogs(logging.Filter):
    """Drops uvicorn access-log lines for the GET endpoints polled every 3s
    by the live dashboard pages (KpiDeviationPrediction.tsx,
    ProcessMonitoring.tsx), to control Log Analytics ingestion volume.

    Scoped to GET only, so POST/DELETE requests on the same /api/live-batches
    path (create/stop/delete a batch) still log normally - only the
    repeated polling reads are silenced.
    """

    SUPPRESSED_PATH_PREFIXES = (
        '/api/kpi-prediction/',  # KpiDeviationPrediction.tsx poll
        '/api/live-batches',  # bare (KpiDeviationPrediction.tsx poll) + /{id}/telemetry (ProcessMonitoring.tsx poll)
    )

    def filter(self, record: logging.LogRecord) -> bool:
        if record.args and len(record.args) >= 3:
            method, path = record.args[1], record.args[2]
            if method == 'GET' and isinstance(path, str) and path.startswith(self.SUPPRESSED_PATH_PREFIXES):
                return False
        return True
