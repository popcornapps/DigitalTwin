"""Tests for app.main.SuppressHighFrequencyAccessLogs: asserts the filter
drops exactly the 3 polled GET endpoints (and nothing else), and never
drops non-GET requests on the same paths (create/stop/delete a batch).

Plain unittest, matching test_scheduler.py - no test framework is installed
in this project's requirements.txt.
"""
import logging
import unittest

from app.logging_filters import SuppressHighFrequencyAccessLogs


def _access_log_record(method: str, path: str) -> logging.LogRecord:
    # Mirrors uvicorn's own access_logger.info(...) call signature:
    # '%s - "%s %s HTTP/%s" %d', client_addr, method, path_with_query, http_version, status
    return logging.LogRecord(
        name='uvicorn.access',
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg='%s - "%s %s HTTP/%s" %d',
        args=('127.0.0.1:12345', method, path, '1.1', 200),
        exc_info=None,
    )


class SuppressHighFrequencyAccessLogsTest(unittest.TestCase):
    def setUp(self):
        self.filter = SuppressHighFrequencyAccessLogs()

    def test_suppresses_kpi_prediction_poll(self):
        record = _access_log_record('GET', '/api/kpi-prediction/RUN123')
        self.assertFalse(self.filter.filter(record))

    def test_suppresses_bare_live_batches_poll(self):
        record = _access_log_record('GET', '/api/live-batches')
        self.assertFalse(self.filter.filter(record))

    def test_suppresses_live_batches_telemetry_poll(self):
        record = _access_log_record('GET', '/api/live-batches/RUN123/telemetry')
        self.assertFalse(self.filter.filter(record))

    def test_does_not_suppress_create_batch_post(self):
        record = _access_log_record('POST', '/api/live-batches')
        self.assertTrue(self.filter.filter(record))

    def test_does_not_suppress_stop_batch_post(self):
        record = _access_log_record('POST', '/api/live-batches/RUN123/stop')
        self.assertTrue(self.filter.filter(record))

    def test_does_not_suppress_delete_batch(self):
        record = _access_log_record('DELETE', '/api/live-batches/RUN123')
        self.assertTrue(self.filter.filter(record))

    def test_does_not_suppress_unrelated_endpoint(self):
        record = _access_log_record('GET', '/api/batches?scope=all')
        self.assertTrue(self.filter.filter(record))

    def test_does_not_suppress_settings_endpoint(self):
        record = _access_log_record('POST', '/api/settings/ai-mode')
        self.assertTrue(self.filter.filter(record))


if __name__ == '__main__':
    unittest.main()
