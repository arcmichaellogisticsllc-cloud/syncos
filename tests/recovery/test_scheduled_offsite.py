import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/recovery'))
import scheduled_offsite as scheduled
import test_offsite_checkpoint as fixture

class ScheduledTests(unittest.TestCase):
    setUp = fixture.RecoveryTests.setUp
    save_manifest = fixture.RecoveryTests.save_manifest

    def prepare(self):
        root = self.source.parent / 'shared'
        deployments = root / 'deployments'; deployments.mkdir(parents=True)
        target = deployments / 'checkpoint-20261118-synthetic'
        self.source.rename(target); self.source = target
        (deployments / 'offsite-source.json').write_text(json.dumps({'checkpoint': str(target)}))
        original_put = self.client.put_object
        def put(**kw):
            # The moving latest pointer has no create-only condition.
            if kw['Key'] == 'staging/latest.json':
                kw['IfNoneMatch'] = '*'
            return original_put(**kw)
        self.client.put_object = put
        return root

    def test_success_publishes_pointer_and_preserves_deployment_checkpoints(self):
        root = self.prepare()
        unrelated = root / 'deployments/checkpoint-existing'; unrelated.mkdir()
        old_root = root / 'offsite-checkpoints'; old_root.mkdir()
        for n in range(8):
            p = old_root / ('checkpoint-202601%02d' % (n+1)); p.mkdir(); (p/'UPLOADED.json').write_text('{}')
        failed = old_root / 'checkpoint-20250101-failed'; failed.mkdir()
        with patch.object(scheduled, 'ROOT', root), patch.object(scheduled.subprocess, 'run') as run:
            result = scheduled.transfer_checkpoint(self.store)
        run.assert_called_once_with(['systemctl','start','syncos-staging-checkpoint.service'], check=True)
        self.assertTrue(result['uploaded']); self.assertTrue(unrelated.exists()); self.assertTrue(failed.exists())
        self.assertEqual(len(list(old_root.glob('*/UPLOADED.json'))), 7)
        self.assertTrue(any(key == 'staging/latest.json' for key, version in self.client.objects))

    def test_checkpoint_failure_does_not_upload(self):
        root = self.prepare()
        with patch.object(scheduled, 'ROOT', root), patch.object(scheduled.subprocess, 'run', side_effect=RuntimeError('checkpoint failed')):
            with self.assertRaises(RuntimeError): scheduled.transfer_checkpoint(self.store)
        self.assertEqual(self.client.objects, {})
        self.assertTrue(self.source.exists())

    def test_upload_failure_preserves_local_copy_and_previous_backups(self):
        root = self.prepare()
        with patch.object(scheduled, 'ROOT', root), patch.object(scheduled.subprocess, 'run'), patch.object(scheduled, 'upload', side_effect=RuntimeError('upload failed')):
            with self.assertRaises(RuntimeError): scheduled.transfer_checkpoint(self.store)
        self.assertTrue((root/'offsite-checkpoints'/self.source.name/'COMPLETE').is_file())
        self.assertFalse(list(root.glob('offsite-checkpoints/*/UPLOADED.json')))
        self.assertEqual(self.client.objects,{})

    def test_pointer_readback_failure_does_not_mark_success(self):
        root = self.prepare()
        original = self.store.read
        def read(ref, **kw):
            if ref['key'] == 'staging/latest.json': raise RuntimeError('pointer readback failed')
            return original(ref, **kw)
        with patch.object(scheduled, 'ROOT', root), patch.object(scheduled.subprocess, 'run'), patch.object(self.store, 'read', side_effect=read):
            with self.assertRaisesRegex(RuntimeError, 'pointer readback'): scheduled.transfer_checkpoint(self.store)
        self.assertFalse(list(root.glob('offsite-checkpoints/*/UPLOADED.json')))
        self.assertTrue(list(root.glob('offsite-receipts/*.json')))
