import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/recovery'))
import staging_checkpoint as c


class CoordinationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        for name, value in [('ROOT', self.root), ('MARKER', self.root / 'restart')]:
            p = patch.object(c, name, value); p.start(); self.addCleanup(p.stop)
        self.calls = []

    def run_command(self, args, **kwargs):
        self.calls.append(args)
        if args[:2] == ['systemctl', 'is-active']:
            return SimpleNamespace(returncode=0 if args[-1] in c.SERVICES else 3)
        if args[0] == 'bash':
            raise RuntimeError('synthetic checkpoint failure')
        return SimpleNamespace(returncode=0)

    def marker(self):
        c.MARKER.write_text('restart-staging-only\n'); c.MARKER.chmod(0o600)

    def ownership(self):
        original = Path.lstat
        def lstat(path, *a, **kw):
            r = original(path, *a, **kw)
            return SimpleNamespace(st_mode=r.st_mode, st_uid=0)
        return patch.object(Path, 'lstat', lstat)

    def test_failed_checkpoint_restarts_all_services(self):
        with patch.object(c.subprocess, 'run', self.run_command), patch.object(c.shutil, 'disk_usage', return_value=SimpleNamespace(free=11*1024**3)), self.ownership():
            with self.assertRaisesRegex(RuntimeError, 'synthetic checkpoint failure'):
                c.checkpoint()
        self.assertIn(['systemctl', 'stop', *c.SERVICES], self.calls)
        self.assertIn(['systemctl', 'start', *c.SERVICES], self.calls)
        self.assertFalse(c.MARKER.exists())

    def test_low_disk_never_stops_or_starts_services(self):
        with patch.object(c.subprocess, 'run', self.run_command), patch.object(c.shutil, 'disk_usage', return_value=SimpleNamespace(free=1)):
            with self.assertRaisesRegex(RuntimeError, '10 GiB'):
                c.checkpoint()
        self.assertFalse(c.MARKER.exists())
        self.assertFalse(any(a[1] in ('start', 'stop') for a in self.calls))

    def test_recovery_after_killed_process_restarts_from_marker(self):
        self.marker()
        with patch.object(c.subprocess, 'run', self.run_command), self.ownership():
            c.restart()
        self.assertFalse(c.MARKER.exists())
        self.assertIn(['systemctl', 'start', *c.SERVICES], self.calls)

    def test_failed_restart_retains_marker(self):
        self.marker()
        with patch.object(c.subprocess, 'run', self.run_command), patch.object(c, 'active', return_value=False), self.ownership():
            with self.assertRaisesRegex(RuntimeError, 'incomplete'):
                c.restart()
        self.assertTrue(c.MARKER.exists())

    def test_missing_marker_never_starts_services(self):
        with patch.object(c.subprocess, 'run', self.run_command):
            c.restart()
        self.assertEqual(self.calls, [])

    def test_invalid_marker_refuses_restart(self):
        self.marker(); c.MARKER.chmod(0o644)
        with patch.object(c.subprocess, 'run', self.run_command), self.ownership():
            with self.assertRaisesRegex(RuntimeError, 'Invalid restart marker'):
                c.restart()
        self.assertEqual(self.calls, [])

    def test_pending_recovery_refuses_new_checkpoint(self):
        self.marker()
        with self.assertRaisesRegex(RuntimeError, 'Previous backup'):
            c.checkpoint()

    def test_success_publishes_validated_source_before_restart(self):
        path = self.root / 'shared/deployments/checkpoint-synthetic'
        path.mkdir(parents=True)
        def run(args, **kw):
            if args[0] == 'bash':
                return SimpleNamespace(stdout=json.dumps({'checkpoint': str(path)}))
            return self.run_command(args, **kw)
        with patch.object(c.subprocess, 'run', run), patch.object(c.shutil, 'disk_usage', return_value=SimpleNamespace(free=11*1024**3)), patch.object(c, 'validate') as validate, self.ownership():
            c.checkpoint(); validate.assert_called_once_with(path)
        self.assertTrue((path.parent / 'offsite-source.json').exists())
        self.assertFalse(c.MARKER.exists())
