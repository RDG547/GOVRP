import datetime as dt
from pathlib import Path
import unittest
from unittest.mock import call, patch

import oracle_deploy as deploy


class OracleDeployTest(unittest.TestCase):
    previous = deploy.Release('a' * 40, Path('/previous'), 'bot:previous', 'previous-image')
    candidate = deploy.Release('b' * 40, Path('/candidate'), 'bot:candidate', 'candidate-image')

    @patch.object(deploy, 'record')
    @patch.object(deploy, 'start')
    @patch.object(deploy, 'validate_compose')
    @patch.object(deploy, 'log')
    def test_failed_health_restores_last_image_and_leaves_deploy_failed(self, log, validate, start, record):
        start.side_effect = [deploy.DeployError('heartbeat missing'), None]
        with self.assertRaisesRegex(deploy.DeployError, 'versão anterior foi restaurada'):
            deploy.switch(self.candidate, self.previous)
        self.assertEqual(start.call_args_list, [call(self.candidate), call(self.previous)])
        record.assert_not_called()

    @patch.object(deploy, 'record')
    @patch.object(deploy, 'start')
    @patch.object(deploy, 'validate_compose')
    @patch.object(deploy, 'log')
    def test_failed_rollback_is_reported_once(self, log, validate, start, record):
        start.side_effect = deploy.DeployError('heartbeat missing')
        with self.assertRaisesRegex(deploy.DeployError, 'Rollback falhou'):
            deploy.switch(self.candidate, self.previous)
        self.assertEqual(start.call_count, 2)
        record.assert_not_called()

    @patch.object(deploy, 'start')
    @patch.object(deploy, 'validate_compose', side_effect=deploy.DeployError('invalid volume'))
    def test_invalid_compose_leaves_service_running(self, validate, start):
        with self.assertRaisesRegex(deploy.DeployError, 'invalid volume'):
            deploy.switch(self.candidate, self.previous)
        start.assert_not_called()

    @patch.object(deploy, 'log')
    @patch.object(deploy.time, 'sleep')
    @patch.object(deploy, 'heartbeat')
    @patch.object(deploy, 'container')
    def test_health_requires_two_new_signals_from_paired_bot(self, container, heartbeat, sleep, log):
        start = deploy.now() - dt.timedelta(seconds=35)
        first = start + dt.timedelta(seconds=5)
        second = start + dt.timedelta(seconds=30)
        container.return_value = {'Image': self.candidate.image_id, 'State': {'Running': True}, 'RestartCount': 0}
        heartbeat.side_effect = [(start, True), (first, True), (first, True), (second, True)]
        deploy.wait_healthy(self.candidate, start)
        self.assertEqual(heartbeat.call_count, 4)

    @patch.object(deploy, 'heartbeat')
    @patch.object(deploy, 'container')
    def test_restarted_container_cannot_pass_health_check(self, container, heartbeat):
        container.return_value = {'Image': self.candidate.image_id, 'State': {'Running': True}, 'RestartCount': 1}
        with self.assertRaisesRegex(deploy.DeployError, 'estável'):
            deploy.wait_healthy(self.candidate, deploy.now())
        heartbeat.assert_not_called()
