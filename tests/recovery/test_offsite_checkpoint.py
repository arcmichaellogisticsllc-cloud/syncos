import copy
import datetime as dt
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('offsite', Path(__file__).resolve().parents[2] / 'scripts/recovery/offsite_checkpoint.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


class FakeS3:
    def __init__(self):
        self.objects = {}
        self.calls = []
        self.corrupt = False
        self.unversioned = False
        self.fail_after = None

    def put_object(self, **kw):
        self.calls.append(kw)
        if self.fail_after is not None and len(self.calls) > self.fail_after:
            raise OSError('simulated upload failure')
        data = kw['Body'].read()
        assert kw['ExpectedBucketOwner'] == '123456789012'
        assert kw['ServerSideEncryption'] == 'AES256'
        assert kw['IfNoneMatch'] == '*'
        assert kw['ContentLength'] == len(data)
        assert kw['ChecksumSHA256'] == m.base64.b64encode(hashlib.sha256(data).digest()).decode()
        version = str(len(self.calls))
        self.objects[(kw['Key'], version)] = data
        return {'VersionId': 'null' if self.unversioned else version}

    def get_object(self, **kw):
        assert kw['ExpectedBucketOwner'] == '123456789012'
        data = self.objects[(kw['Key'], kw['VersionId'])]
        if self.corrupt:
            data = bytes([data[0] ^ 1]) + data[1:]
        return dict(Body=io.BytesIO(data), ContentLength=len(data), VersionId=kw['VersionId'])


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.manifest = dict(createdAt=dt.datetime.now(dt.timezone.utc).isoformat(),
                             release='a' * 40, writersStopped=True, offsite=False, files={})
        for name in m.PAYLOADS:
            data = ('synthetic ' + name).encode()
            (self.source / name).write_bytes(data)
            self.manifest['files'][name] = dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
        self.save_manifest()
        (self.source / 'COMPLETE').write_text('complete')
        self.client = FakeS3()
        self.store = m.Store(self.client, 'test-backup-bucket', '123456789012')

    def save_manifest(self):
        (self.source / 'manifest.json').write_text(json.dumps(self.manifest))

    def test_round_trip_pinned_versions_and_private_destination(self):
        pointer = m.upload(self.store, self.source)
        target = self.root / 'restored'
        result = m.retrieve(self.store, pointer, target)
        self.assertEqual(result, self.manifest)
        self.assertEqual(target.stat().st_mode & 0o777, 0o700)
        for name in m.FILES:
            self.assertEqual((target / name).read_bytes(), (self.source / name).read_bytes())
            self.assertEqual((target / name).stat().st_mode & 0o777, 0o600)
        self.assertTrue((target / 'COMPLETE').exists())
        self.assertEqual(len(self.client.calls), 4)
        self.assertTrue(self.client.calls[-1]['Key'].endswith('/COMPLETE.json'))

    def test_corrupt_local_payload_never_uploads(self):
        (self.source / 'database.dump').write_bytes(b'corrupt')
        with self.assertRaises(ValueError):
            m.upload(self.store, self.source)
        self.assertEqual(self.client.calls, [])

    def test_running_writers_rejected(self):
        self.manifest['writersStopped'] = False
        self.save_manifest()
        with self.assertRaises(ValueError):
            m.validate(self.source)

    def test_missing_complete_rejected(self):
        (self.source / 'COMPLETE').unlink()
        with self.assertRaises(FileNotFoundError):
            m.upload(self.store, self.source)
        self.assertEqual(self.client.calls, [])

    def test_symlink_payload_rejected(self):
        payload = self.source / 'database.dump'
        payload.rename(self.root / 'other')
        payload.symlink_to(self.root / 'other')
        with self.assertRaises(ValueError):
            m.validate(self.source)

    def test_invalid_timestamp_and_release_rejected(self):
        for field, value in [('createdAt', '2026-01-01T00:00:00'), ('release', '../bad'),
                             ('createdAt', (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)).isoformat())]:
            with self.subTest(field=field, value=value):
                old = self.manifest[field]
                self.manifest[field] = value
                self.save_manifest()
                with self.assertRaises(ValueError):
                    m.validate(self.source)
                self.manifest[field] = old

    def test_readback_corruption_prevents_receipt_publication(self):
        self.client.corrupt = True
        with self.assertRaises(ValueError):
            m.upload(self.store, self.source)
        self.assertEqual(len(self.client.calls), 1)

    def test_unversioned_bucket_rejected(self):
        self.client.unversioned = True
        with self.assertRaises(ValueError):
            m.upload(self.store, self.source)
        self.assertEqual(len(self.client.calls), 1)

    def test_interrupted_upload_never_publishes_receipt(self):
        self.client.fail_after = 1
        with self.assertRaises(OSError):
            m.upload(self.store, self.source)
        self.assertFalse(any(k.endswith('/COMPLETE.json') for k, v in self.client.objects))

    def test_corrupt_download_removes_only_new_destination(self):
        pointer = m.upload(self.store, self.source)
        payload = next(k for k in self.client.objects if k[0].endswith('database.dump'))
        data = self.client.objects[payload]
        self.client.objects[payload] = b'x' * len(data)
        target = self.root / 'restored'
        with self.assertRaises(ValueError):
            m.retrieve(self.store, pointer, target)
        self.assertFalse(target.exists())
        self.assertTrue(self.source.exists())

    def test_existing_destination_never_modified(self):
        pointer = m.upload(self.store, self.source)
        target = self.root / 'existing'
        target.mkdir()
        (target / 'precious').write_text('keep')
        with self.assertRaises(FileExistsError):
            m.retrieve(self.store, pointer, target)
        self.assertEqual((target / 'precious').read_text(), 'keep')

    def test_wrong_account_and_traversal_rejected(self):
        pointer = m.upload(self.store, self.source)
        bad = copy.deepcopy(pointer)
        bad['owner'] = '111111111111'
        with self.assertRaises(ValueError):
            m.retrieve(self.store, bad, self.root / 'out')
        bad = copy.deepcopy(pointer)
        bad['receipt']['key'] = '../outside/COMPLETE.json'
        with self.assertRaises(ValueError):
            m.retrieve(self.store, bad, self.root / 'out')

    def test_oversized_response_is_bounded_and_closed(self):
        stream = io.BytesIO(b'a' * 1000)
        self.client.get_object = lambda **kw: dict(Body=stream, ContentLength=2, VersionId='1')
        entry = dict(key='test', version='1', bytes=2, sha256=hashlib.sha256(b'aa').hexdigest())
        with self.assertRaises(ValueError):
            self.store.read(entry)
        self.assertTrue(stream.closed)

    def test_oversized_manifest_rejected(self):
        (self.source / 'manifest.json').write_bytes(b' ' * (m.MAX_JSON + 1))
        with self.assertRaises(ValueError):
            m.validate(self.source)


if __name__ == '__main__':
    unittest.main()
