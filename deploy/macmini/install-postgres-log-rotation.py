#!/usr/bin/env python3
"""Install a separately reviewed, log-only daily job; never rotates on install."""
import argparse
import datetime
import hashlib
import fcntl
import stat
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess

LABEL = 'com.openclaw.opscenter.postgres-log-rotation'


def checked_path(path, directory=False):
    for parent in [path, *path.parents]:
        if parent.is_symlink(): raise RuntimeError('symlink in installation destination')
    if path.exists():
        info=path.stat()
        expected=stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
        if not expected or info.st_uid != os.getuid() or info.st_mode & 0o022 or (not directory and info.st_nlink != 1):
            raise RuntimeError('unsafe installation destination')


def validate_destinations(home, stamp):
    control=home/'Library/Application Support/OpsCenter/log-control'
    logs=home/'Library/Logs/OpsCenter'
    launch=home/'Library/LaunchAgents'
    backup=control/'install-backups'/stamp
    for path in [control, control/'install-backups', backup, logs, launch]: checked_path(path, True)
    for path in [control/'rotate-postgres-log.py', launch/f'{LABEL}.plist',
                 logs/'postgres-log-rotation.log', logs/'postgres-log-rotation.err.log',
                 logs/'.postgres-log-rotation.lock', backup/'receipt.json']:
        checked_path(path)
    return control, logs, launch/f'{LABEL}.plist', backup


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reviewed-commit',required=True)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[2]
    def git(*words): return subprocess.check_output(['git','-C',str(root),*words],text=True).strip()
    commit=git('rev-parse','HEAD')
    if args.reviewed_commit != commit or git('status','--porcelain','--untracked-files=no'):
        raise RuntimeError('installation requires the exact clean reviewed commit')
    source=root/'scripts/rotate-postgres-log.py'
    if not git('ls-files','--error-unmatch',str(source)):
        raise RuntimeError('helper is not committed')
    home=Path.home()
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    control, logs, launch, backup=validate_destinations(home, stamp)
    target=control/source.name
    plist={'Label':LABEL,'ProgramArguments':['/usr/bin/python3',str(target),'--apply'],
           'StartCalendarInterval':{'Hour':2,'Minute':45},'ProcessType':'Background',
           'StandardOutPath':str(logs/'postgres-log-rotation.log'),
           'StandardErrorPath':str(logs/'postgres-log-rotation.err.log')}
    contents=plistlib.dumps(plist)
    report={'commit':commit,'helper':str(target),'helperSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
            'launchAgent':str(launch),'launchAgentSha256':hashlib.sha256(contents).hexdigest(),
            'schedule':'daily 02:45 host local time','apply':args.apply}
    if not args.apply:
        print(json.dumps(report,indent=2));return
    logs.mkdir(parents=True,exist_ok=True)
    # Hold the helper's lock through replacement/launchd registration. A running
    # rotation prevents installation; never interrupt its archive transaction.
    lock=os.open(logs/'.postgres-log-rotation.lock', os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
    backup.mkdir(parents=True,mode=0o700)
    launch.parent.mkdir(parents=True,exist_ok=True)
    logs.mkdir(parents=True,exist_ok=True)
    for path in [target,launch]:
        if path.is_symlink():raise RuntimeError('installed target is a symlink')
        if path.exists():shutil.copy2(path,backup/path.name)
    for path,data in [(target,source.read_bytes()),(launch,contents)]:
        tmp=path.with_name(path.name+'.install-tmp')
        with tmp.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
        os.chmod(tmp,0o600);os.replace(tmp,path)
    domain=f'gui/{os.getuid()}'
    service=f'{domain}/{LABEL}'
    loaded=subprocess.run(['launchctl','print',service],capture_output=True).returncode==0
    if loaded:subprocess.run(['launchctl','bootout',service],check=True)
    subprocess.run(['launchctl','bootstrap',domain,str(launch)],check=True)
    subprocess.run(['launchctl','enable',service],check=True)
    subprocess.run(['launchctl','print',service],check=True,stdout=subprocess.DEVNULL)
    report.update(installedAt=stamp,backup=str(backup))
    (backup/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
    os.close(lock)
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
