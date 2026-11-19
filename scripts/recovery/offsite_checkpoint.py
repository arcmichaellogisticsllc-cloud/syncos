#!/usr/bin/env python3
"""Transfer completed staging checkpoints; never extract archives or change services."""
import argparse
import base64
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import uuid

PAYLOADS = ('database.dump', 'private-files.tar.gz')
FILES = (*PAYLOADS, 'manifest.json')
MAX_FILE = 4 * 1024**3
MAX_JSON = 65536
PREFIX = 'staging/checkpoints/'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def encoded(value):
    return (json.dumps(value, sort_keys=True) + '\n').encode()


def digest_file(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def regular(path, limit):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode), 'Checkpoint entries must be regular files')
    require(0 < info.st_size <= limit, 'Checkpoint entry size outside bounds')


def timestamp(value):
    require(isinstance(value, str), 'Invalid checkpoint timestamp')
    result = dt.datetime.fromisoformat(value)
    require(result.tzinfo is not None, 'Checkpoint timestamp needs a timezone')
    require(result <= dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5),
            'Checkpoint timestamp is in the future')
    return result


def metadata(value, limit):
    require(isinstance(value, dict), 'Invalid file metadata')
    require(type(value.get('bytes')) is int and 0 < value['bytes'] <= limit, 'Invalid byte count')
    require(isinstance(value.get('sha256'), str) and
            re.fullmatch('[a-f0-9]{64}', value['sha256']), 'Invalid SHA256')


def validate(root, require_complete=True):
    root = Path(root)
    require(root.is_dir() and not root.is_symlink(), 'Checkpoint must be a real directory')
    if require_complete:
        regular(root / 'COMPLETE', MAX_JSON)
    regular(root / 'manifest.json', MAX_JSON)
    manifest = json.loads((root / 'manifest.json').read_bytes())
    require(isinstance(manifest, dict), 'Invalid manifest')
    require(manifest.get('writersStopped') is True, 'Checkpoint writers were not stopped')
    require(isinstance(manifest.get('release'), str) and
            re.fullmatch('[a-f0-9]{40}', manifest['release']), 'Invalid source release')
    timestamp(manifest.get('createdAt'))
    require(isinstance(manifest.get('files'), dict) and
            set(manifest['files']) == set(PAYLOADS), 'Unexpected checkpoint payloads')
    for name in PAYLOADS:
        entry = manifest['files'][name]
        metadata(entry, MAX_FILE)
        regular(root / name, MAX_FILE)
        require((root / name).stat().st_size == entry['bytes'] and
                digest_file(root / name) == entry['sha256'], 'Checkpoint checksum mismatch')
    return manifest


class Store:
    def __init__(self, client, bucket, owner):
        require(re.fullmatch('[0-9]{12}', owner), 'Expected AWS account must have 12 digits')
        require(re.fullmatch('[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', bucket), 'Invalid bucket name')
        self.client, self.bucket, self.owner = client, bucket, owner

    def args(self, key):
        return dict(Bucket=self.bucket, Key=key, ExpectedBucketOwner=self.owner)

    def put(self, key, stream, size, digest):
        result = self.client.put_object(
            **self.args(key), Body=stream, ContentLength=size,
            ServerSideEncryption='AES256', IfNoneMatch='*',
            ChecksumSHA256=base64.b64encode(bytes.fromhex(digest)).decode())
        version = result.get('VersionId')
        require(isinstance(version, str) and version not in ('', 'null'), 'Versioned bucket required')
        entry = dict(key=key, version=version, bytes=size, sha256=digest)
        self.read(entry)  # Independently read the exact stored version before publishing it.
        return entry

    def read(self, entry, destination=None, limit=MAX_FILE):
        metadata(entry, limit)
        require(isinstance(entry.get('version'), str) and entry['version'] not in ('', 'null'),
                'Missing pinned version')
        response = self.client.get_object(**self.args(entry['key']), VersionId=entry['version'])
        stream = response['Body']
        try:
            require(response.get('VersionId') == entry['version'], 'Returned version mismatch')
            require(response.get('ContentLength') == entry['bytes'], 'Remote length mismatch')
            output = destination if destination is not None else io.BytesIO() if limit == MAX_JSON else None
            h, count = hashlib.sha256(), 0
            while True:
                chunk = stream.read(min(1024 * 1024, entry['bytes'] - count + 1))
                if not chunk:
                    break
                count += len(chunk)
                require(count <= entry['bytes'], 'Remote content exceeds declared size')
                h.update(chunk)
                if output is not None:
                    output.write(chunk)
            require(count == entry['bytes'] and h.hexdigest() == entry['sha256'], 'Remote checksum mismatch')
            return output.getvalue() if isinstance(output, io.BytesIO) else None
        finally:
            stream.close()


def upload(store, source):
    # A private copy prevents later local edits from changing bytes between validation and upload.
    validate(source)
    with tempfile.TemporaryDirectory(prefix='syncos-upload-') as directory:
        root = Path(directory)
        for name in (*FILES, 'COMPLETE'):
            shutil.copyfile(Path(source) / name, root / name)
            (root / name).chmod(0o600)
        manifest = validate(root)
        key = PREFIX + uuid.uuid4().hex + '/'
        entries = {}
        for name in FILES:
            path = root / name
            with path.open('rb') as stream:
                entries[name] = store.put(key + name, stream, path.stat().st_size, digest_file(path))
        receipt = dict(schema=1, bucket=store.bucket, owner=store.owner, prefix=key,
                       createdAt=manifest['createdAt'], release=manifest['release'], files=entries)
        data = encoded(receipt)
        require(len(data) <= MAX_JSON, 'Receipt too large')
        remote = store.put(key + 'COMPLETE.json', io.BytesIO(data), len(data), hashlib.sha256(data).hexdigest())
        return dict(schema=1, bucket=store.bucket, owner=store.owner, receipt=remote)


def publish_latest(store, pointer):
    """Publish the pointer returned by this process's verified upload."""
    require(pointer.get('bucket') == store.bucket and pointer.get('owner') == store.owner,
            'Pointer identity mismatch')
    store.read(pointer['receipt'], limit=MAX_JSON)
    data = encoded(pointer)
    digest = hashlib.sha256(data).hexdigest()
    result = store.client.put_object(**store.args('staging/latest.json'), Body=io.BytesIO(data),
        ContentLength=len(data), ServerSideEncryption='AES256',
        ChecksumSHA256=base64.b64encode(bytes.fromhex(digest)).decode())
    store.read(dict(key='staging/latest.json', version=result.get('VersionId'),
                    bytes=len(data), sha256=digest), limit=MAX_JSON)


def retrieve(store, pointer, destination):
    require(isinstance(pointer, dict) and pointer.get('schema') == 1 and
            pointer.get('bucket') == store.bucket and pointer.get('owner') == store.owner,
            'Backup destination identity mismatch')
    entry = pointer['receipt']
    require(re.fullmatch(re.escape(PREFIX) + '[a-f0-9]{32}/COMPLETE.json', entry['key']),
            'Invalid receipt location')
    receipt = json.loads(store.read(entry, limit=MAX_JSON))
    prefix = entry['key'].removesuffix('COMPLETE.json')
    require(receipt.get('schema') == 1 and receipt.get('bucket') == store.bucket and
            receipt.get('owner') == store.owner and receipt.get('prefix') == prefix,
            'Receipt identity mismatch')
    timestamp(receipt.get('createdAt'))
    require(isinstance(receipt.get('files'), dict) and set(receipt['files']) == set(FILES),
            'Unexpected receipt payloads')
    for name in FILES:
        item = receipt['files'][name]
        require(item.get('key') == prefix + name, 'Payload outside checkpoint prefix')
        metadata(item, MAX_JSON if name == 'manifest.json' else MAX_FILE)
    target = Path(destination)
    target.mkdir(mode=0o700, parents=False, exist_ok=False)
    try:
        for name in FILES:
            with (target / name).open('xb') as output:
                os.chmod(target / name, 0o600)
                store.read(receipt['files'][name], output,
                           limit=MAX_JSON if name == 'manifest.json' else MAX_FILE)
        manifest = validate(target, require_complete=False)
        require(manifest['release'] == receipt['release'] and manifest['createdAt'] == receipt['createdAt'],
                'Receipt does not match checkpoint')
        (target / 'COMPLETE').write_text('Downloaded pinned versions and verified checksums.\n')
        (target / 'COMPLETE').chmod(0o600)
        return manifest
    except BaseException:
        shutil.rmtree(target)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['validate', 'upload', 'retrieve'])
    parser.add_argument('path', type=Path)
    parser.add_argument('--bucket')
    parser.add_argument('--owner')
    parser.add_argument('--region', default='us-east-2')
    parser.add_argument('--receipt', type=Path, help='Upload output or retrieve input; never overwrite')
    parser.add_argument('--publish-latest', action='store_true', help='After upload, update the monitored staging pointer')
    args = parser.parse_args()
    require(not args.publish_latest or args.action == 'upload', '--publish-latest requires upload')
    os.umask(0o077)
    if args.action == 'validate':
        manifest = validate(args.path)
        print(json.dumps({'valid': True, 'release': manifest['release'], 'createdAt': manifest['createdAt']}))
        return
    require(args.bucket and args.owner and args.receipt, 'Bucket, owner and receipt are required')
    import boto3
    from botocore.config import Config
    session = boto3.Session(region_name=args.region)
    require(session.client('sts').get_caller_identity()['Account'] == args.owner, 'AWS account mismatch')
    store = Store(session.client('s3', config=Config(connect_timeout=10, read_timeout=60,
                  retries={'max_attempts': 3, 'mode': 'standard'})), args.bucket, args.owner)
    if args.action == 'upload':
        # Reserve receipt path before any remote writes; failed uploads leave no success receipt.
        with args.receipt.open('xb') as output:
            try:
                pointer = upload(store, args.path)
                output.write(encoded(pointer))
                output.flush()
                os.fsync(output.fileno())
            except BaseException:
                args.receipt.unlink()
                raise
        if args.publish_latest:
            publish_latest(store, pointer)
        print('Uploaded and read-back verified; retain the receipt for independent retrieval.')
    else:
        regular(args.receipt, MAX_JSON)
        retrieve(store, json.loads(args.receipt.read_bytes()), args.path)
        print('Retrieved and checksum verified. Database restore rehearsal is still required.')


if __name__ == '__main__':
    main()
