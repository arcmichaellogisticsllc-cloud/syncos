import datetime as dt
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/recovery'))
import external_monitor as m
import test_offsite_checkpoint as fixture
import offsite_checkpoint as transfer

class FreshnessTests(unittest.TestCase):
    setUp=fixture.RecoveryTests.setUp
    save_manifest=fixture.RecoveryTests.save_manifest

    def fixture(self):
        pointer=transfer.upload(self.store,self.source)
        self.client.objects[('staging/latest.json','latest')]=transfer.encoded(pointer)
        original=self.client.get_object
        def get(**kw):
            kw.setdefault('VersionId','latest')
            return original(**kw)
        self.client.get_object=get
        def head(**kw):
            return {'ContentLength':len(self.client.objects[(kw['Key'],kw['VersionId'])]),'VersionId':kw['VersionId']}
        self.client.head_object=head
        return pointer

    def test_fresh_verified_backup_is_healthy(self):
        self.fixture()
        self.assertEqual(m.backup_check(self.client,self.store.bucket,self.store.owner,dt.datetime.now(dt.timezone.utc)),self.manifest['createdAt'])

    def test_old_source_timestamp_is_stale_even_when_upload_is_new(self):
        self.manifest['createdAt']=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(hours=37)).isoformat();self.save_manifest();self.fixture()
        with self.assertRaisesRegex(ValueError,'36 hours'):
            m.backup_check(self.client,self.store.bucket,self.store.owner,dt.datetime.now(dt.timezone.utc))

    def test_missing_payload_fails_monitor(self):
        self.fixture()
        key=next(k for k in self.client.objects if k[0].endswith('database.dump'));del self.client.objects[key]
        with self.assertRaises(KeyError):
            m.backup_check(self.client,self.store.bucket,self.store.owner,dt.datetime.now(dt.timezone.utc))

    def test_corrupt_receipt_fails_monitor(self):
        pointer=self.fixture();key=(pointer['receipt']['key'],pointer['receipt']['version'])
        self.client.objects[key]=self.client.objects[key].replace(b'"schema": 1',b'"schema": 2')
        with self.assertRaises(ValueError):
            m.backup_check(self.client,self.store.bucket,self.store.owner,dt.datetime.now(dt.timezone.utc))

    def test_wrong_migration_health_fails(self):
        class Response(io.BytesIO):
            status=200
            headers={'Content-Type':'application/json'}
        response=Response(json.dumps({'ok':True,'migrations':{'ok':False}}).encode())
        with patch.object(m.urllib.request,'build_opener') as opener:
            opener.return_value.open.return_value=response
            with self.assertRaises(ValueError):m.web_check('https://example.test/health',True)

    def test_redirect_is_not_followed(self):
        self.assertIsNone(m.NoRedirect().redirect_request(None,None,302,'redirect',{},'https://outside.test'))
