"""Run explicitly in the installed recovery-tools environment; no AWS network calls."""
import io
import importlib.util
from pathlib import Path
import boto3
from botocore.stub import Stubber, ANY
from botocore.response import StreamingBody

spec = importlib.util.spec_from_file_location('offsite', Path(__file__).resolve().parents[2] / 'scripts/recovery/offsite_checkpoint.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
client = boto3.client('s3', region_name='us-east-2', aws_access_key_id='synthetic', aws_secret_access_key='synthetic')
body = b'synthetic checkpoint'
digest = m.hashlib.sha256(body).hexdigest()
args = dict(Bucket='test-backup-bucket', Key='staging/checkpoints/test/database.dump', ExpectedBucketOwner='123456789012')
with Stubber(client) as stub:
    stub.add_response('put_object', {'VersionId': 'pinned-1'}, {
        **args, 'Body': ANY, 'ContentLength': len(body), 'ServerSideEncryption': 'AES256',
        'IfNoneMatch': '*', 'ChecksumSHA256': m.base64.b64encode(bytes.fromhex(digest)).decode()})
    stub.add_response('get_object', {'VersionId': 'pinned-1', 'ContentLength': len(body),
                                   'Body': StreamingBody(io.BytesIO(body), len(body))},
                      {**args, 'VersionId': 'pinned-1'})
    result = m.Store(client, args['Bucket'], args['ExpectedBucketOwner']).put(args['Key'], io.BytesIO(body), len(body), digest)
    assert result['version'] == 'pinned-1'
    stub.assert_no_pending_responses()
print('AWS SDK upload and pinned-version readback contract passed; no network calls made.')
