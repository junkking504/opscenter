#!/usr/bin/env python3
"""Prevent the legacy KeepAlive job from rebinding after first proxy handover."""
import json
import os
from pathlib import Path
import re
import stat
import sys

STATE = Path('/Users/missioncontrol/opscenter-v2/.release-slots')

def allowed(directory=STATE):
    if not directory.exists() and not directory.is_symlink(): return True
    info=directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or directory.resolve()!=directory or info.st_uid!=os.getuid() or info.st_mode&0o077:
        raise ValueError('Legacy launch state directory is invalid')
    file=directory/'legacy-launch.json'
    try:fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW)
    except FileNotFoundError:return True
    try:
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_nlink!=1 or info.st_mode&0o077 or info.st_size>4096:
            raise ValueError('Legacy launch guard is invalid')
        with os.fdopen(os.dup(fd)) as stream:value=json.load(stream)
    finally:os.close(fd)
    if value.get('version')!=1 or type(value.get('blocked')) is not bool or not re.fullmatch('[a-f0-9]{40}',value.get('sha') or ''):
        raise ValueError('Legacy launch guard identity is invalid')
    return not value['blocked']

if __name__=='__main__':
    try:
        if not allowed():
            print('[run_opscenter] legacy launch blocked by reviewed proxy handover',file=sys.stderr)
            sys.exit(75)
    except Exception:
        print('[run_opscenter] legacy launch guard unavailable; refusing startup',file=sys.stderr)
        sys.exit(75)
