#!/usr/bin/env python3
"""Bounded read-only Merchant Center refresh, isolated from the QBO import path."""
import fcntl
import json
import os
import signal
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ZONE = ZoneInfo('America/Chicago')
ROOT = Path(os.environ.get('OPSBOT_DATA_DIR', str(Path.home()/'.openclaw/workspace/opsbot/data')))
DIRECTORY = ROOT/'imports/merchant_center/junk_krewe'
SCRIPT = Path(__file__).with_name('collect-merchant-center-live.py')


def save(value):
    target = DIRECTORY/'refresh.json'
    temporary = target.with_suffix(f'.{os.getpid()}.tmp')
    temporary.write_text(json.dumps(value)+'\n'); temporary.chmod(0o600); temporary.replace(target)


def main():
    DIRECTORY.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (DIRECTORY/'refresh.lock').open('w') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return 0
        now = datetime.now(ZONE)
        previous = {}
        try: previous = json.loads((DIRECTORY/'refresh.json').read_text())
        except (OSError, ValueError): pass
        if previous.get('nextAttemptEpoch', 0) > time.time(): return 0
        today=now.date(); yesterday=today-timedelta(days=1)
        dates={today.isoformat(), yesterday.isoformat()}
        # Revisit unresolved days this month. One export per invocation bounds load.
        for file in (ROOT/'history/payment_reconciliation').glob(f'payment_reconciliation_{today:%Y-%m}-*.json'):
            try:
                report=json.loads(file.read_text())
                if report.get('status')!='balanced' and report.get('date','')<=today.isoformat(): dates.add(report['date'])
            except (OSError,ValueError,KeyError): pass
        due=[]
        for date in dates:
            try:
                report=json.loads((DIRECTORY/f'transactions-{date}.json').read_text())
                observed=datetime.fromisoformat(report['collectedAt'].replace('Z','+00:00')).timestamp()
            except (OSError,ValueError,KeyError): observed=0
            interval=15*60 if date in (today.isoformat(), yesterday.isoformat()) else 24*3600
            if time.time()-observed>=interval: due.append((0 if date==yesterday.isoformat() else 1 if date==today.isoformat() else 2,observed,date))
        if not due: return 0
        date=sorted(due)[0][2]
        save({'status':'running','date':date,'observedAt':now.isoformat(),'nextAttemptEpoch':time.time()+180})
        process=subprocess.Popen([sys.executable,str(SCRIPT),'--date',date,'--output-dir',str(DIRECTORY)], stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
        try:
            _, error=process.communicate(timeout=180)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid,signal.SIGTERM)
            try: process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid,signal.SIGKILL);process.communicate()
            error='Merchant Center export timed out.'
        ok=process.returncode==0
        # Do not publish browser output, account cookies, or credential diagnostics.
        message=None if ok else ('Merchant Center sign-in is required in its collection browser.' if 'sign-in' in error.lower() else 'Merchant Center automatic export failed; last verified evidence retained.')
        save({'status':'ok' if ok else 'error','date':date,'observedAt':datetime.now(ZONE).isoformat(),'message':message,'nextAttemptEpoch':time.time()+(180 if ok else 1800)})
        return 0 if ok else 1

if __name__=='__main__': sys.exit(main())
