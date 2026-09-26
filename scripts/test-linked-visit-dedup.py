#!/usr/bin/env python3
"""No-network regression for linked estimate/job physical-visit de-duplication."""
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("installer", HERE / "install-linked-visit-dedup.py")
installer = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(installer)
helper_spec = importlib.util.spec_from_file_location("linked_visit_dedup", HERE / "runtime" / "linked_visit_dedup.py")
dedup = importlib.util.module_from_spec(helper_spec)
assert helper_spec.loader
helper_spec.loader.exec_module(dedup)


class LinkedVisitTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data = Path(self.temp.name)
        history = self.data / "history" / "junkware"
        history.mkdir(parents=True)
        (history / "junkware_2026-09-26_raw.json").write_text('{"appointments":[{"appt_id":"job","source_estimate_appointment_id":"estimate"}]}')
        self.parse = lambda value: datetime.fromisoformat(str(value).replace("Z", "+00:00")) if value else None
        self.iso = lambda value: value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        self.truck = lambda value: str(value or "").replace("#", "").strip()

    def test_linked_job_owns_identical_physical_episode(self):
        interval = {"arrival":"2026-09-26T14:36:45Z","departure":"2026-09-26T15:04:14Z","onsite_minutes":27.48}
        estimate = {"appointment_id":"estimate","jk_number":"JKE","truck_number":"Truck 2","match_confidence":"confirmed","pass_by_only":False,"visit_intervals":[interval],"onsite_minutes":27.48,"visit_count":1}
        job = {"appointment_id":"job","jk_number":"JKJ","truck_number":"Truck 2","match_confidence":"confirmed","pass_by_only":False,"visit_intervals":[dict(interval)],"onsite_minutes":27.48,"visit_count":1}
        rows = dedup.reconcile_linked_physical_visits([estimate, job], date(2026,9,26), self.data, self.parse, self.iso, self.truck)
        self.assertEqual(rows[0]["match_reason"], "physical_visit_attributed_to_linked_job")
        self.assertEqual(rows[0]["visit_intervals"], [])
        self.assertEqual(rows[0]["physical_visit_owner_appointment_id"], "job")
        self.assertEqual(rows[1]["match_confidence"], "confirmed")

    def test_distinct_episode_is_not_suppressed(self):
        estimate = {"appointment_id":"estimate","truck_number":"Truck 2","match_confidence":"confirmed","visit_intervals":[{"arrival":"2026-09-26T13:00:00Z","departure":"2026-09-26T13:20:00Z"}]}
        job = {"appointment_id":"job","truck_number":"Truck 2","match_confidence":"confirmed","visit_intervals":[{"arrival":"2026-09-26T14:36:45Z","departure":"2026-09-26T15:04:14Z"}]}
        dedup.reconcile_linked_physical_visits([estimate, job], date(2026,9,26), self.data, self.parse, self.iso, self.truck)
        self.assertEqual(estimate["match_confidence"], "confirmed")

    def test_patches_are_idempotent_and_compile(self):
        matcher = '''from geocode_junkware_appointments import address_hash, normalize_address\n\ndef main():\n    output, target = [], None\n    # Unique appointment/truck rows are mandatory.\n    return output\n'''
        validator = '''from collections import Counter\nfrom typing import Any\ndef validate(rows):\n    failures = []\n    keys: set[tuple[str, Any]] = set()\n    for row in rows:\n        key = (str(row.get("appointment_id") or ""), row.get("truck_number"))\n        visits = row.get("visit_intervals") or []\n        if int(row.get("visit_count") or 0) != len(visits):\n            failures.append("visit_count_mismatch")\n    counts = Counter(str(row.get("match_confidence")) for row in rows)\n    return failures, counts\n'''
        for name, patcher, source in [
            ("match_linxup_appointment_visits.py", installer.patch_matcher, matcher),
            ("validate_linxup_appointment_visits.py", installer.patch_validator, validator),
        ]:
            patched = patcher(source)
            self.assertEqual(patcher(patched), patched)
            compile(patched, name, "exec")

    def test_installer_backs_up_and_is_idempotent(self):
        root = self.data / "opsbot"
        scripts = root / "scripts"
        scripts.mkdir(parents=True)
        matcher = 'from geocode_junkware_appointments import address_hash, normalize_address\n\ndef main():\n    output, target = [], None\n    # Unique appointment/truck rows are mandatory.\n    return output\n'
        validator = 'from collections import Counter\nfrom typing import Any\ndef validate(rows):\n    failures = []\n    keys: set[tuple[str, Any]] = set()\n    for row in rows:\n        key = (str(row.get("appointment_id") or ""), row.get("truck_number"))\n        visits = row.get("visit_intervals") or []\n        if int(row.get("visit_count") or 0) != len(visits):\n            failures.append("visit_count_mismatch")\n    counts = Counter(str(row.get("match_confidence")) for row in rows)\n    return failures, counts\n'
        originals = {"match_linxup_appointment_visits.py":matcher,"validate_linxup_appointment_visits.py":validator}
        for name, source in originals.items():
            (scripts / name).write_text(source)
        baselines = {name:installer.digest(source.encode()) for name,source in originals.items()}
        installed = {
            "match_linxup_appointment_visits.py":installer.digest(installer.patch_matcher(matcher).encode()),
            "validate_linxup_appointment_visits.py":installer.digest(installer.patch_validator(validator).encode()),
            "linked_visit_dedup.py":installer.digest(installer.SOURCE.read_bytes()),
        }
        with patch.dict(installer.BASELINES, baselines, clear=True), patch.dict(installer.INSTALLED, installed, clear=True):
            self.assertEqual(len(installer.install(root, True)),3)
            self.assertEqual(installer.install(root, True),[])
        backups = list((root / "backups").iterdir())
        self.assertEqual(len(backups),1)
        self.assertFalse((backups[0] / "linked_visit_dedup.py").exists())


if __name__ == "__main__":
    unittest.main()
