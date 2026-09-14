#!/usr/bin/env python3
"""Publish a transactional read-only standby database; never restore production."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import tempfile
from datetime import datetime, timezone

CONTROL = Path.home() / 'Library/Application Support/OpsCenter/continuity-control'
PG = Path('/opt/homebrew/opt/postgresql@18/bin')
SOCKET = Path.home() / 'Library/Application Support/OpsCenter/postgres-production-socket'
TARGET = 'opscenter_recovery_20260914'
READER = 'opscenter_standby_reader'
SSH = ['ssh', '-i', str(Path.home() / '.ssh/id_ed25519_opscenter'), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2', 'opscenter@104.248.63.228']


def restore_sql(dump_sql):
    if not dump_sql.strip() or 'opscenter_kernel' not in dump_sql:
        raise ValueError('Backup has no platform schema')
    # pg_dump resets timeouts in its session preamble. Reapply bounded limits
    # after that preamble, before any schema/data statements (never edit COPY rows).
    dump_sql = dump_sql.replace('SET row_security = off;',
        "SET row_security = off;\nSET lock_timeout = '5s';\nSET statement_timeout = '30s';\nSET transaction_timeout = '60s';", 1)
    return f"""BEGIN;
SET lock_timeout = '5s';
DO $$ BEGIN
IF current_database() <> '{TARGET}' OR
   has_table_privilege('{READER}', 'opscenter_kernel.work_items', 'INSERT,UPDATE,DELETE') OR
   has_schema_privilege('{READER}', 'opscenter_kernel', 'CREATE')
THEN RAISE EXCEPTION 'Standby ownership changed; publication refused'; END IF;
END $$;
""" + dump_sql + f"""
GRANT USAGE ON SCHEMA opscenter_kernel TO {READER};
GRANT SELECT ON ALL TABLES IN SCHEMA opscenter_kernel TO {READER};
COMMIT;
SELECT max(version) FROM opscenter_kernel.schema_migrations;
"""


def main():
    os.umask(0o077)
    CONTROL.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (CONTROL / 'database-publish.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        now = lambda: datetime.now(timezone.utc).isoformat()
        status = {'status': 'running', 'startedAt': now(), 'target': TARGET}
        state_path = CONTROL / 'database-publish.json'
        try:
            previous = json.loads(state_path.read_text())
            status['lastSuccessAt'] = previous.get('lastSuccessAt')
        except (ValueError, FileNotFoundError):
            pass
        def save():
            temporary = state_path.with_suffix('.tmp')
            temporary.write_text(json.dumps(status))
            temporary.replace(state_path)
        save()
        try:
            # Reuse the production file worker and its existing single-flight lock.
            # Initial mode is primary-to-mirror only; never pull standby state back.
            data = Path.home() / '.openclaw/workspace/opsbot/data'
            source = Path.home() / 'opscenter-v2/opscenter'
            sync_env = dict(os.environ, OPSBOT_DATA_DIR=str(data), OPSCENTER_VPS=SSH[-1],
                            OPSCENTER_SSH_KEY=str(Path.home() / '.ssh/id_ed25519_opscenter'),
                            OPSCENTER_BACKUP_TIMEOUT_SECONDS='90')
            sync = subprocess.run(['/usr/bin/python3', str(source / 'scripts/run-opscenter-backup-sync.py')],
                                  env=sync_env, capture_output=True, timeout=120)
            status['fileSyncExitCode'] = sync.returncode
            try:
                status['fileLastSuccessAt'] = json.loads((data / 'backup-sync/status.json').read_text()).get('lastSuccessAt')
            except (ValueError, FileNotFoundError):
                status['fileLastSuccessAt'] = None
            # Imported accounting statements live outside OpsBot's data tree.
            # Mirror only their JSON snapshots, never workbook originals or credentials.
            statements = Path.home() / 'Library/Application Support/OpsCenter/financial-statements'
            if not statements.is_dir():
                raise ValueError('Financial statement snapshot directory is unavailable')
            import shlex
            statement_sync = subprocess.run(['rsync', '-rlt', '--delete-delay', '--timeout=30',
                '--include=*.json', '--exclude=*', '-e', shlex.join(SSH[:-1]),
                str(statements) + '/', SSH[-1] + ':/srv/opscenter/continuity-20260912/financial-statements/'],
                capture_output=True, check=True, timeout=60)
            status['financialStatementsSyncedAt'] = now()
            with tempfile.TemporaryDirectory(prefix='restore-', dir=CONTROL) as temp:
                dump = Path(temp) / 'standby.dump'
                subprocess.run([str(PG / 'pg_dump'), '-h', str(SOCKET), '-p', '55433', '-U', 'opscenter_production_app', '-d', 'opscenter_production', '--format=custom', '--no-owner', '--no-privileges', '-f', str(dump)], check=True, capture_output=True, timeout=60)
                sql = subprocess.run([str(PG / 'pg_restore'), '--clean', '--if-exists', '--no-owner', '--no-privileges', '-f', '-', str(dump)], check=True, capture_output=True, text=True, timeout=30).stdout
                result = subprocess.run(SSH + ['/home/opscenter/receive-continuity-database.sh'], input=restore_sql(sql), text=True, capture_output=True, check=True, timeout=90)
                if '0001_kernel.sql' not in result.stdout:
                    raise ValueError('Restored schema receipt missing')
            status.update(status='success', finishedAt=now())
            status['lastSuccessAt'] = status['finishedAt']
            save()
            print('Read-only standby database publication verified.')
            return 0
        except Exception as error:
            # DB/SSH errors can contain credentials or records. Keep public status narrow.
            status.update(status='failed', finishedAt=now(), error=type(error).__name__)
            save()
            print('Standby database publication failed; the last committed snapshot remains available.')
            return 1

if __name__ == '__main__':
    raise SystemExit(main())
