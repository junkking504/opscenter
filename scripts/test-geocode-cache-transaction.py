#!/usr/bin/env python3
import copy
import importlib.util
import json
import multiprocessing
from pathlib import Path
import tempfile
import unittest
import sys

sys.path.insert(0, str(Path(__file__).parent / "runtime"))
from geocode_cache_transaction import merge_geocode_cache


def writer(path, baseline, proposal, barrier, results):
    barrier.wait(timeout=10)
    try:
        merge_geocode_cache(path, baseline, proposal)
        results.put("saved")
    except ValueError:
        results.put("conflict")


class CacheTransactionTest(unittest.TestCase):
    def test_concurrent_independent_and_conflicting_updates(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "appointment_geocodes.json"
            base = {"schema_version": 2, "addresses": {"existing": {"latitude": 30}}}
            path.write_text(json.dumps(base))
            for keys, expected in [(("a", "b"), ["saved", "saved"]), (("same", "same"), ["conflict", "saved"])]:
                baseline = json.loads(path.read_text())
                proposals = [copy.deepcopy(baseline), copy.deepcopy(baseline)]
                for i, key in enumerate(keys):
                    proposals[i]["addresses"][key] = {"latitude": 30 + i / 100}
                barrier, results = multiprocessing.Barrier(2), multiprocessing.Queue()
                processes = [multiprocessing.Process(target=writer, args=(path, baseline, proposal, barrier, results)) for proposal in proposals]
                for process in processes: process.start()
                for process in processes:
                    process.join(timeout=15)
                    self.assertEqual(process.exitcode, 0)
                self.assertEqual(sorted(results.get(timeout=2) for _ in processes), expected)
            saved = json.loads(path.read_text())["addresses"]
            self.assertEqual(set(saved), {"existing", "a", "b", "same"})
            self.assertFalse(list(Path(directory).glob("*.tmp")))

    def test_damaged_cache_and_deletion_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cache.json"
            base = {"addresses": {"a": {"latitude": 30}}}
            path.write_text("broken")
            with self.assertRaises(ValueError): merge_geocode_cache(path, base, base)
            self.assertEqual(path.read_text(), "broken")
            path.write_text(json.dumps(base))
            with self.assertRaises(ValueError): merge_geocode_cache(path, base, {"addresses": {}})
            self.assertEqual(json.loads(path.read_text()), base)

    def test_writer_migration_fails_closed_and_is_idempotent(self):
        spec = importlib.util.spec_from_file_location("installer", Path(__file__).with_name("install-geocode-cache-transaction.py"))
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        fixture = "import json\ndef main():\n    cache = load_cache()\n    write_json(GEOCODE_CACHE_PATH, cache)\n"
        changed = module.update(fixture)
        self.assertIn("cache_baseline = deepcopy(cache)", changed)
        self.assertEqual(module.update(changed), changed)
        with self.assertRaises(ValueError): module.update("import json\n")


if __name__ == "__main__": unittest.main()
