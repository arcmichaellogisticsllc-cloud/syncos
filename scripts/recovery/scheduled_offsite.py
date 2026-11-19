#!/usr/bin/env python3
"""Root-only scheduled checkpoint transfer; credentials stay in protected SDK config."""
import fcntl
import json
import os
import shutil
from pathlib import Path
import stat
import subprocess
import uuid
from offsite_checkpoint import Store, upload, encoded, validate, publish_latest


ROOT = Path("/opt/syncos/staging/shared")
CONFIG = Path("/etc/syncos/staging/offsite.json")
LOCK = Path("/run/lock/syncos-staging-offsite.lock")

def transfer_checkpoint(store):
    subprocess.run(["systemctl", "start", "syncos-staging-checkpoint.service"], check=True)
    source = Path(json.loads((ROOT / "deployments/offsite-source.json").read_text())["checkpoint"])
    if source.parent != ROOT / "deployments" or not source.name.startswith("checkpoint-"):
        raise RuntimeError("Invalid checkpoint path")
    validate(source)
    checkpoint_root = ROOT / "offsite-checkpoints"
    checkpoint_root.mkdir(mode=0o700, exist_ok=True)
    dedicated = checkpoint_root / source.name
    if dedicated.exists() or dedicated.is_symlink():
        raise RuntimeError("Dedicated checkpoint already exists")
    source.rename(dedicated)
    pointer = upload(store, dedicated)
    receipts = ROOT / "offsite-receipts"
    receipts.mkdir(mode=0o700, exist_ok=True)
    receipt = receipts / (uuid.uuid4().hex + ".json")
    with receipt.open("xb") as stream:
        stream.write(encoded(pointer))
    publish_latest(store, pointer)
    (dedicated / "UPLOADED.json").write_bytes(encoded(pointer))
    successful = sorted(p for p in checkpoint_root.iterdir() if p.is_dir() and not p.is_symlink()
                        and p.name.startswith("checkpoint-") and (p / "UPLOADED.json").is_file())
    for old in successful[:-7]:
        if old != dedicated:
            shutil.rmtree(old)
    return {"uploaded": True, "receiptKey": pointer["receipt"]["key"],
            "checkpointCreatedFrom": dedicated.name}

def main():
    if os.geteuid() != 0:
        raise RuntimeError('Staging administrator required')
    os.umask(0o077)
    with LOCK.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        config = CONFIG
        info = config.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o777 != 0o600:
            raise RuntimeError('Offsite configuration must be root-owned mode 0600')
        settings = json.loads(config.read_text())
        import boto3
        from botocore.config import Config
        session = boto3.Session(region_name='us-east-2')
        if session.client('sts').get_caller_identity()['Account'] != settings['owner']:
            raise RuntimeError('AWS account mismatch')
        store = Store(session.client('s3', config=Config(connect_timeout=10, read_timeout=60,
                      retries={'max_attempts': 3, 'mode': 'standard'})), settings['bucket'], settings['owner'])
        print(json.dumps(transfer_checkpoint(store)))


if __name__ == '__main__':
    main()
