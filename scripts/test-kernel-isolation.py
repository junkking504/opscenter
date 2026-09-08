import copy
import importlib.util
import pathlib
import tempfile
import unittest

source = pathlib.Path(__file__).resolve().parents[1] / 'deploy/macmini/verify-kernel-isolation.py'
spec = importlib.util.spec_from_file_location('isolation', source)
isolation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(isolation)


class IsolationTests(unittest.TestCase):
    def setUp(self):
        self.prod = {'OPSCENTER_KERNEL_ENABLED': '1', 'OPSCENTER_MISSION_CONTROL_DATABASE_URL': 'postgresql://app@localhost/opscenter_production'}
        self.preview = {'OPSCENTER_KERNEL_ENABLED': '1', 'OPSCENTER_PREVIEW_DATABASE_URL': 'postgresql://app@localhost/opscenter_preview'}
        self.prod_health = self.health('MISSION_CONTROL', 'opscenter_production')
        self.preview_health = self.health('MAC_MINI_PREVIEW', 'opscenter_preview')

    @staticmethod
    def health(runtime, name):
        return {'runtime': runtime, 'platformKernel': {'runtime': runtime, 'enabled': True, 'healthy': True, 'status': 'healthy', 'databaseName': name}}

    def test_enabled_and_isolated(self):
        isolation.validate(self.prod, self.preview, self.prod_health, self.preview_health, True)

    def test_same_database_rejected(self):
        self.prod['OPSCENTER_MISSION_CONTROL_DATABASE_URL'] = self.preview['OPSCENTER_PREVIEW_DATABASE_URL']
        self.prod_health['platformKernel']['databaseName'] = 'opscenter_preview'
        with self.assertRaises(ValueError):
            isolation.validate(self.prod, self.preview, self.prod_health, self.preview_health)

    def test_wrong_unhealthy_and_missing_runtime_rejected(self):
        for key, value in [('databaseName', 'other'), ('healthy', False), ('status', 'unavailable'), ('enabled', False), ('runtime', 'MISSION_CONTROL')]:
            with self.subTest(key=key):
                changed = copy.deepcopy(self.preview_health)
                changed['platformKernel'][key] = value
                with self.assertRaises(ValueError):
                    isolation.validate(self.prod, self.preview, self.prod_health, changed)
        with self.assertRaises(ValueError):
            isolation.validate(self.prod, self.preview, self.prod_health, {})

    def test_disabled_production_still_supported(self):
        self.prod['OPSCENTER_KERNEL_ENABLED'] = '0'
        self.prod_health['platformKernel'].update(enabled=False, status='disabled')
        isolation.validate(self.prod, self.preview, self.prod_health, self.preview_health, True)

    def test_production_database_in_preview_rejected(self):
        self.preview['OPSCENTER_PREVIEW_DATABASE_URL'] = self.prod['OPSCENTER_MISSION_CONTROL_DATABASE_URL']
        self.preview_health['platformKernel']['databaseName'] = 'opscenter_production'
        with self.assertRaises(ValueError):
            isolation.validate(self.prod, self.preview, self.prod_health, self.preview_health)

    def test_database_override_rejected(self):
        self.preview['OPSCENTER_PREVIEW_DATABASE_URL'] += '?dbname=opscenter_production'
        with self.assertRaises(ValueError):
            isolation.validate(self.prod, self.preview, self.prod_health, self.preview_health)

    def test_quoted_environment_is_not_executed(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / 'env'
            file.write_text("DATABASE='postgresql://app@localhost/example?port=5432'\nLITERAL=$(false)\n")
            result = isolation.read_environment(file)
            self.assertEqual(result['DATABASE'], 'postgresql://app@localhost/example?port=5432')
            self.assertEqual(result['LITERAL'], '$(false)')


if __name__ == '__main__':
    unittest.main()
