"""Exercise the actual controller migration boundary with isolated fake executables."""
import json
import os
from pathlib import Path
import shlex
import shutil
import urllib.parse
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'deploy/macmini/deploy-release.sh').read_text()
FUNCTION = SOURCE[SOURCE.index('migrate_production_release() {'):SOURCE.index('trap release_deploy_lock EXIT')]
BOUNDARY = SOURCE[SOURCE.index('migrate_production_release "$release"'):SOURCE.index('previous_target="$(readlink "$APP_LINK")"')]
LOCK = SOURCE[SOURCE.index('release_deploy_lock() {'):SOURCE.index('acquire_deploy_lock() {')]


class ProductionMigrations(unittest.TestCase):
    def run_boundary(self, config=None, exit_code=0, head_changed=False):
        with tempfile.TemporaryDirectory(prefix='ops-migration-controller-') as directory:
            temp = Path(directory)
            (temp / 'production.env').write_text(config if config is not None else
                "OPSCENTER_KERNEL_ENABLED=1\nOPSCENTER_MISSION_CONTROL_DATABASE_URL='postgres://fixture:synthetic@localhost/opscenter_production'\n"
                'OPSCENTER_WEB_PUSH_ENABLED=1\nOPSCENTER_WEB_PUSH_CAPTURE_ENABLED=1\nNODE_OPTIONS=--invalid\n')
            (temp / 'node').write_text('#!/usr/bin/python3\nimport json,os,pathlib,sys\n'
                'p=pathlib.Path.cwd()\n(p/"runner.json").write_text(json.dumps({"env":dict(os.environ),"args":sys.argv[1:],"cwd":str(p),"pid":os.getpid()}))\n'
                '(p/"order").write_text("migrate\\n")\n'
                'print("synthetic-private-diagnostic",file=sys.stderr)\n'
                + f'sys.exit({exit_code})\n')
            (temp / 'node').chmod(0o755)
            shell = 'set -euo pipefail\n' + FUNCTION + '\n' + '\n'.join([
                'fail(){ print -u2 -- "$*"; exit 78; }',
                'git(){ if [[ "$*" == *fetch* ]]; then print fetch >> "$release/order"; else print active-sha; fi; }',
                'readlink(){ print fixture-active; }',
                'require_production_head(){ print head-check >> "$release/order"; ' + ('return 1;' if head_changed else 'return 0;') + ' }',
                'require_forward_deploy(){ print lineage >> "$release/order"; }',
                'ACTIVE_DEPLOY_CHILD=""', 'commit=fixture-target', 'REPOSITORY=fixture-repository', 'APP_LINK=fixture-link',
                BOUNDARY, 'print activate >> "$release/order"',
            ])
            environment = dict(os.environ, PATH=str(temp)+os.pathsep+os.environ['PATH'],
                SHARED_CONFIG=str(temp), SCRIPT_DIR=str(ROOT/'deploy/macmini'), release=str(temp),
                NODE_OPTIONS='--invalid', OPSCENTER_RUNTIME='MAC_MINI_PREVIEW',
                OPSCENTER_WEB_PUSH_ENABLED='1', OPSCENTER_PREVIEW_DATABASE_URL='must-not-inherit',
                AWS_SECRET_ACCESS_KEY='synthetic-must-not-inherit')
            result = subprocess.run(['/bin/zsh', '-c', shell], env=environment, capture_output=True, text=True, timeout=10)
            runner = json.loads((temp/'runner.json').read_text()) if (temp/'runner.json').exists() else None
            order = (temp/'order').read_text().splitlines() if (temp/'order').exists() else []
            return result, runner, order

    def test_success_before_activation_and_fresh_lineage_checks(self):
        result, runner, order = self.run_boundary()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(order, ['migrate', 'fetch', 'head-check', 'lineage', 'activate'])
        self.assertEqual(runner['args'], ['--import', 'tsx', 'scripts/migrate-platform-kernel.ts'])
        self.assertEqual(runner['env']['OPSCENTER_RUNTIME'], 'MISSION_CONTROL')
        self.assertEqual(runner['env']['OPSCENTER_KERNEL_DB_POOL_MAX'], '1')
        for key in ['NODE_OPTIONS','OPSCENTER_WEB_PUSH_ENABLED','OPSCENTER_WEB_PUSH_CAPTURE_ENABLED','OPSCENTER_PREVIEW_DATABASE_URL','AWS_SECRET_ACCESS_KEY']:
            self.assertNotIn(key, runner['env'])
        self.assertNotIn('synthetic-private-diagnostic', result.stdout+result.stderr)

    def test_migration_failure_blocks_every_activation_action(self):
        result, runner, order = self.run_boundary(exit_code=42)
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNotNone(runner)
        self.assertEqual(order, ['migrate'])
        self.assertIn('release activation was not attempted', result.stderr)
        self.assertNotIn('synthetic-private-diagnostic', result.stdout+result.stderr)

    def test_changed_production_head_blocks_activation_after_migration(self):
        result, _, order = self.run_boundary(head_changed=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(order, ['migrate', 'fetch', 'head-check'])

    def test_invalid_config_never_starts_runner(self):
        for config in [
            '', 'invalid assignment',
            'OPSCENTER_KERNEL_ENABLED=0\nOPSCENTER_MISSION_CONTROL_DATABASE_URL=postgres://localhost/opscenter_production',
            'OPSCENTER_KERNEL_ENABLED=1\nOPSCENTER_MISSION_CONTROL_DATABASE_URL=postgres://localhost/opscenter_preview',
            'OPSCENTER_KERNEL_ENABLED=1\nOPSCENTER_MISSION_CONTROL_DATABASE_URL=postgres://localhost/opscenter_production?dbname=opscenter_preview',
            'OPSCENTER_KERNEL_ENABLED=1\nOPSCENTER_MISSION_CONTROL_DATABASE_URL=$(touch /tmp/should-never-run)',
        ]:
            with self.subTest(config=config):
                result, runner, order = self.run_boundary(config=config)
                self.assertNotEqual(result.returncode, 0)
                self.assertIsNone(runner)
                self.assertEqual(order, [])
                self.assertNotIn(config, result.stderr) if config else None

    def test_actual_both_mode_activation_is_after_migration(self):
        boundary = SOURCE.index('migrate_production_release "$release"')
        self.assertLess(SOURCE.index('npm run build'), boundary)
        self.assertLess(SOURCE.index('verify-spending-boundary.mjs'), boundary)
        self.assertLess(SOURCE.index('check-review-gate.py" "$REPOSITORY"'), boundary)
        self.assertLess(boundary, SOURCE.index('release-transaction.mjs" deploy'))
        self.assertLess(boundary, SOURCE.index('activate_release "$release"'))
        self.assertLess(boundary, SOURCE.index('restart_release_bound_services "$release"'))

    def test_real_runner_transactions_resume_and_checksum_guard(self):
        # A disposable cluster, no TCP listener, no production configuration.
        bin_dir = Path('/opt/homebrew/opt/postgresql@18/bin')
        with tempfile.TemporaryDirectory(prefix='ops-controller-pg-') as directory:
            temp = Path(directory); socket = temp/'socket'; socket.mkdir()
            data = temp/'db'; release = temp/'release'; release.mkdir()
            env = {'PATH': os.environ['PATH'], 'LANG': 'C', 'LC_ALL': 'C'}
            def pg(name, *args):
                return subprocess.run([str(bin_dir/name), *map(str,args)], env=env, capture_output=True, text=True, check=True, timeout=30)
            pg('initdb','-D',data,'--no-locale','-A','trust','-U','migration_test')
            pg('pg_ctl','-D',data,'-l',temp/'server.log','-o',f"-h '' -k {socket} -p 5432",'-w','start')
            try:
                pg('createdb','-h',socket,'-U','migration_test','opscenter_production')
                def sql(query):
                    return pg('psql','-h',socket,'-U','migration_test','-d','opscenter_production','-At','-v','ON_ERROR_STOP=1','-c',query).stdout.strip()
                for file in ['scripts/migrate-platform-kernel.ts','lib/platform/persistence/pool.ts','lib/platform/persistence/config.ts','lib/runtime.ts','tsconfig.json']:
                    dest=release/file; dest.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(ROOT/file,dest)
                migrations=release/'lib/platform/persistence/migrations'
                shutil.copytree(ROOT/'lib/platform/persistence/migrations',migrations)
                (release/'node_modules').symlink_to((ROOT/'node_modules').resolve(),target_is_directory=True)
                config=temp/'production.env'
                config.write_text('OPSCENTER_KERNEL_ENABLED=1\nOPSCENTER_MISSION_CONTROL_DATABASE_URL=postgresql://migration_test@localhost/opscenter_production?host='+urllib.parse.quote(str(socket),safe='')+'\n')
                sql("CREATE TABLE public.existing_fixture (value text); INSERT INTO public.existing_fixture VALUES ('preserved')")
                fourth=sorted(migrations.glob('*.sql'))[3]; original=fourth.read_text()
                fourth.write_text('CREATE TABLE public.rollback_fixture (id integer); SELECT * FROM public.fixture_missing_relation;')
                shell='set -euo pipefail\n'+FUNCTION+'\nfail(){ print -u2 -- "$*"; exit 78; }\nACTIVE_DEPLOY_CHILD=""\nmigrate_production_release "$release"\nprint activated\n'
                runner_env=dict(env,SHARED_CONFIG=str(temp),SCRIPT_DIR=str(ROOT/'deploy/macmini'),release=str(release))
                def run(): return subprocess.run(['/bin/zsh','-c',shell],env=runner_env,capture_output=True,text=True,timeout=30)
                failed=run(); self.assertNotEqual(failed.returncode,0)
                self.assertNotIn('activated',failed.stdout)
                self.assertEqual(sql('SELECT count(*) FROM opscenter_kernel.schema_migrations'),'3')
                self.assertEqual(sql("SELECT to_regclass('public.rollback_fixture') IS NULL"),'t')
                fourth.write_text(original)
                resumed=run(); self.assertEqual(resumed.returncode,0,resumed.stderr)
                versions=sql('SELECT version || checksum || applied_at FROM opscenter_kernel.schema_migrations ORDER BY version')
                self.assertEqual(len(versions.splitlines()),len(list((ROOT / "lib/platform/persistence/migrations").glob("*.sql"))))
                repeated=run(); self.assertEqual(repeated.returncode,0,repeated.stderr)
                self.assertEqual(sql('SELECT version || checksum || applied_at FROM opscenter_kernel.schema_migrations ORDER BY version'),versions)
                fourth.write_text(original+'\n-- checksum drift fixture\n')
                drift=run(); self.assertNotEqual(drift.returncode,0)
                self.assertNotIn('activated',drift.stdout)
                self.assertEqual(sql('SELECT value FROM public.existing_fixture'),'preserved')
            finally:
                pg('pg_ctl','-D',data,'-m','immediate','-w','stop')

    def test_live_child_retains_deployment_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory)/'lock'; lock.mkdir(); (lock/'owner').write_text('fixture')
            shell = 'set -euo pipefail\n'+LOCK+'\nDEPLOY_LOCK_HELD=true\nACTIVE_DEPLOY_CHILD=$$\nrelease_deploy_lock\n'
            result=subprocess.run(['/bin/zsh','-c',shell],env=dict(os.environ,DEPLOY_LOCK_DIR=str(lock)),capture_output=True,text=True)
            self.assertEqual(result.returncode,0)
            self.assertTrue((lock/'owner').exists())
            self.assertNotIn('ACTIVE_DEPLOY_CHILD=""', FUNCTION.split('  else\n')[1])


if __name__ == '__main__':
    unittest.main()
