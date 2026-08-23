"""Regression test for the tick-loop crash fixed in app.live.scheduler:
previously, an exception raised while refreshing one running batch's
prediction/assessment/KPI data propagated out of _run_tick() and killed the
whole background tick loop permanently (see scheduler.py's own comments for
why that failure was silent). This test asserts that one batch raising no
longer stops the other batches from being processed, and no longer escapes
_run_tick() itself.

Plain unittest (not pytest) - no test framework is installed in this
project's requirements.txt, and IsolatedAsyncioTestCase (stdlib, 3.8+) is
enough to drive the async _run_tick() directly without adding a dependency.
"""
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from app.live import scheduler
from app.live.models import RunningBatch


def _make_batch(running_batch_id: str) -> RunningBatch:
    return RunningBatch(
        running_batch_id=running_batch_id,
        plant='Hyderabad Plant',
        product='Paracetamol 500mg',
        status='Running',
        scenario_profile='Normal',
        drifting_parameter=None,
        phase='drying',
        started_at=datetime.now(timezone.utc),
        elapsed_minutes=31,
        target_duration_minutes=452,
    )


class TickLoopResilienceTest(unittest.IsolatedAsyncioTestCase):
    async def test_one_batch_error_does_not_stop_others_or_escape(self):
        bad_batch = _make_batch('RUN-HYD-001')
        good_batch = _make_batch('RUN-HYD-002')

        def refresh_prediction(batch):
            if batch.running_batch_id == bad_batch.running_batch_id:
                raise RuntimeError('boom - simulated KPI/AI failure')

        with (
            patch.object(scheduler.running_batch_registry, 'tick_all', return_value=[]),
            patch.object(
                scheduler.running_batch_registry, 'list_batches', return_value=[bad_batch, good_batch],
            ),
            patch.object(scheduler.service, 'prune_old_demo_batches'),
            patch.object(scheduler.service, 'purge_old_alerts'),
            patch.object(scheduler.ml_bridge, 'refresh_prediction', side_effect=refresh_prediction) as mock_refresh,
            patch.object(scheduler.deviation_agent, 'assess') as mock_assess,
            patch.object(scheduler.kpi_prediction_agent, 'predict_kpis', return_value=None),
            patch.object(scheduler.alert_registry, 'sync_from_assessment', new_callable=AsyncMock),
            patch.object(scheduler.alert_registry, 'sync_from_kpi_prediction', new_callable=AsyncMock),
            patch.object(scheduler.logging, 'exception') as mock_log_exception,
        ):
            # The bug: this used to raise out of _run_tick() and, one layer
            # up, kill _tick_loop()'s `while True` forever.
            await scheduler._run_tick()

            # Both batches were attempted...
            mock_refresh.assert_any_call(bad_batch)
            mock_refresh.assert_any_call(good_batch)
            # ...and the good one still got processed after the bad one blew up.
            mock_assess.assert_called_once_with(good_batch)
            # ...and the failure was actually logged, naming the batch that failed.
            self.assertTrue(mock_log_exception.called)
            logged_args = mock_log_exception.call_args.args
            self.assertIn(bad_batch.running_batch_id, logged_args)


if __name__ == '__main__':
    unittest.main()
