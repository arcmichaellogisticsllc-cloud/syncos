#!/usr/bin/env python3
"""One-shot staging checkpoint with restart recovery; run through the supplied unit."""
import fcntl
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
from offsite_checkpoint import validate

ROOT = Path('/opt/syncos/staging')
MARKER = Path('/run/syncos-staging-backup.restart')
LOCK = Path('/run/lock/syncos-staging-deploy.lock')
SERVICES = ('syncos-staging-api', 'syncos-staging-web', 'syncos-staging-worker')
LEGACY = ('syncos-api', 'syncos-web', 'syncos-worker')
HELPER = '/usr/local/libexec/syncos/checkpoint-staging.sh'
ENV = '/etc/syncos/staging/api.env'


def active(service):
    return subprocess.run(['systemctl', 'is-active', '--quiet', service]).returncode == 0


def restart():
    if not MARKER.exists() and not MARKER.is_symlink():
        return
    info = MARKER.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o777 != 0o600:
        raise RuntimeError('Invalid restart marker; administrator recovery required')
    if MARKER.read_text() != 'restart-staging-only\n':
        raise RuntimeError('Unrecognized restart marker')
    subprocess.run(['systemctl', 'start', *SERVICES], check=True)
    if not all(active(s) for s in SERVICES):
        raise RuntimeError('Staging restart incomplete; marker retained')
    MARKER.unlink()


def checkpoint():
    if MARKER.exists() or MARKER.is_symlink():
        raise RuntimeError('Previous backup needs restart recovery')
    if any(active(s) for s in LEGACY) or not all(active(s) for s in SERVICES):
        raise RuntimeError('Staging must be active and legacy writers stopped')
    if shutil.disk_usage(ROOT).free < 10 * 1024**3:
        raise RuntimeError('Checkpoint needs at least 10 GiB available')
    with MARKER.open('x') as output:
        os.chmod(MARKER, 0o600)
        output.write('restart-staging-only\n')
        output.flush()
        os.fsync(output.fileno())
    try:
        subprocess.run(['systemctl', 'stop', *SERVICES], check=True)
        # Limit helper output files; systemd supplies the runtime deadline and group cleanup.
        result = subprocess.run(['bash', '-c', 'ulimit -f 4194304; exec bash "$1" "$2" "$3"',
                                 'checkpoint', HELPER, str(ROOT), ENV],
                                check=True, capture_output=True, text=True)
        data = json.loads(result.stdout)
        path = Path(data['checkpoint'])
        if path.parent != ROOT / 'shared/deployments' or not path.name.startswith('checkpoint-'):
            raise RuntimeError('Unexpected checkpoint location')
        validate(path)
        report = ROOT / 'shared/deployments/offsite-source.json'
        temp = report.with_suffix('.next')
        temp.write_text(json.dumps(data) + '\n')
        temp.chmod(0o600)
        temp.replace(report)
        print(json.dumps(data), flush=True)
    finally:
        restart()


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Staging administrator required')
    os.umask(0o077)
    with LOCK.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if sys.argv[1:] == ['recover']:
            restart()
        elif not sys.argv[1:]:
            checkpoint()
        else:
            raise RuntimeError('Unknown action')


if __name__ == '__main__':
    main()
