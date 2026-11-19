"""Lambda: independent staging availability and offsite freshness checks."""
import datetime as dt
import hashlib
import json
import os
import re
import urllib.request

MAX_JSON = 65536


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def web_check(url, startup=False):
    if not url.startswith('https://'):
        raise ValueError('HTTPS required')
    with urllib.request.build_opener(NoRedirect).open(url, timeout=10) as response:
        if response.status != 200:
            raise ValueError('Unexpected HTTP status')
        body = response.read(MAX_JSON + 1)
        if startup:
            if len(body) > MAX_JSON:
                raise ValueError('Startup response too large')
            data = json.loads(body)
            migration = data.get('migrations', {})
            if not (data.get('ok') is True and migration.get('ok') is True and
                    migration.get('currentCeiling') == '114_submitted_payment_failure_metadata.sql' and
                    migration.get('appliedCount') == 114 and migration.get('hasCurrentCeiling') is True and
                    migration.get('missing') == [] and migration.get('unexpected') == []):
                raise ValueError('Startup or migration health failed')
        elif 'text/html' not in response.headers.get('Content-Type', ''):
            raise ValueError('Login response is not HTML')


def read_json(s3, bucket, owner, key, version=None):
    args = dict(Bucket=bucket, ExpectedBucketOwner=owner, Key=key)
    if version:
        args['VersionId'] = version
    result = s3.get_object(**args)
    try:
        if result.get('ContentLength', MAX_JSON + 1) > MAX_JSON:
            raise ValueError('Metadata too large')
        body = result['Body'].read(MAX_JSON + 1)
        if len(body) > MAX_JSON:
            raise ValueError('Metadata too large')
        if version and result.get('VersionId') != version:
            raise ValueError('Version mismatch')
        return json.loads(body), body
    finally:
        result['Body'].close()


def backup_check(s3, bucket, owner, now):
    pointer, _ = read_json(s3, bucket, owner, 'staging/latest.json')
    if pointer.get('bucket') != bucket or pointer.get('owner') != owner or pointer.get('schema') != 1:
        raise ValueError('Pointer identity mismatch')
    ref = pointer['receipt']
    if not re.fullmatch('staging/checkpoints/[a-f0-9]{32}/COMPLETE.json', ref['key']):
        raise ValueError('Invalid receipt location')
    if not isinstance(ref.get('version'), str) or ref['version'] in ('', 'null'):
        raise ValueError('Missing receipt version')
    receipt, body = read_json(s3, bucket, owner, ref['key'], ref['version'])
    if len(body) != ref['bytes'] or hashlib.sha256(body).hexdigest() != ref['sha256']:
        raise ValueError('Receipt checksum mismatch')
    prefix = ref['key'].removesuffix('COMPLETE.json')
    if receipt.get('bucket') != bucket or receipt.get('owner') != owner or receipt.get('prefix') != prefix or receipt.get('schema') != 1:
        raise ValueError('Receipt identity mismatch')
    created = dt.datetime.fromisoformat(receipt['createdAt'])
    if created.tzinfo is None or not 0 <= (now - created).total_seconds() <= 36 * 3600:
        raise ValueError('Backup missing or older than 36 hours')
    if set(receipt['files']) != {'database.dump', 'private-files.tar.gz', 'manifest.json'}:
        raise ValueError('Incomplete backup')
    for name, item in receipt['files'].items():
        if item['key'] != prefix + name or not isinstance(item.get('version'), str) or item['version'] in ('', 'null'):
            raise ValueError('Invalid payload reference')
        if type(item.get('bytes')) is not int or not 0 < item['bytes'] <= 4 * 1024**3 or not re.fullmatch('[a-f0-9]{64}', item.get('sha256', '')):
            raise ValueError('Invalid payload metadata')
        head = s3.head_object(Bucket=bucket, ExpectedBucketOwner=owner, Key=item['key'], VersionId=item['version'])
        if head.get('ContentLength') != item['bytes'] or head.get('VersionId') != item['version']:
            raise ValueError('Backup payload unavailable')
    return created.isoformat()


def handler(event, context):
    import boto3
    from botocore.config import Config
    config = Config(connect_timeout=5, read_timeout=5, retries={'total_max_attempts': 2, 'mode': 'standard'})
    failures = []
    checks = [('api', lambda: web_check(os.environ['API_URL'], True)),
              ('web', lambda: web_check(os.environ['WEB_URL'])),
              ('offsite', lambda: backup_check(boto3.client('s3', config=config), os.environ['BUCKET'], os.environ['OWNER'], dt.datetime.now(dt.timezone.utc)))]
    for name, check in checks:
        try:
            check()
        except Exception:
            failures.append(name)  # Do not put response contents or credentials into logs.
    boto3.client('cloudwatch', config=config).put_metric_data(Namespace='SyncOS/Recovery', MetricData=[{
        'MetricName': 'Healthy', 'Dimensions': [{'Name': 'Stack', 'Value': os.environ['STACK']}],
        'Value': 0 if failures else 1, 'Unit': 'Count'}])
    print(json.dumps({'healthy': not failures, 'failedChecks': failures}))
    return {'healthy': not failures, 'failedChecks': failures}
