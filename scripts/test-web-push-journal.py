#!/usr/bin/env python3
"""Synthetic records only. Does not read runtime data, settings or credentials."""
import fcntl
import time
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
import opscenter_push_journal as journal

DAY = datetime.now(timezone.utc).date().isoformat()
STAMP = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def schedule(status="Scheduled", at=STAMP):
    return {"date": DAY, "scraped_at": at, "appointments": [{"appt_id": "synthetic-job", "market": "New Orleans", "job_status": status}],
            "territory_verification": [{"territory_id": "352", "verified": True}]}


class SimulatedCrash(BaseException):
    pass


class JournalTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ops-journal-test-")
        self.root = Path(self.temporary.name)
        self.journal = self.root / "journal"
        self.target = self.root / f"junkware_schedule_fast_{DAY}.json"
    def tearDown(self):
        self.temporary.cleanup()
    def publish(self, payload, **kwargs):
        journal.publish_json(self.target, payload, journal_root=self.journal, enabled=True, **kwargs)
    def entries(self):
        return [json.loads(path.read_text()) for path in sorted((self.journal / "ready").glob("*.json"))]
    def test_burst_order_dedup_and_reversion(self):
        for status in ["Scheduled", "Enroute", "Arrived", "Completed", "Scheduled"]:
            self.publish(schedule(status))
        self.publish(schedule())
        batches = [entry["batches"][0] for entry in self.entries()]
        self.assertEqual([b["sequence"] for b in batches], [1, 2, 3, 4, 5])
        self.assertEqual(batches[0]["observations"], batches[-1]["observations"])
        self.assertEqual(json.loads(self.target.read_text())["appointments"][0]["job_status"], "Scheduled")
        self.assertNotIn("synthetic-job", json.dumps(self.entries()))
        self.assertNotIn("New Orleans", json.dumps(self.entries()))
    def test_schedule_aliases_do_not_fabricate_transitions(self):
        first = schedule()
        first["appointments"][0].update({"truck": "8", "driver": "Synthetic Driver"})
        self.publish(first)
        second = schedule()
        row = second["appointments"][0]
        row["status"] = row.pop("job_status").lower()
        row.update({"assigned_truck": "8", "driver_name": "synthetic driver"})
        self.publish(second)
        self.assertEqual(len(self.entries()), 1)
    def test_recovery_before_and_after_rename(self):
        self.publish(schedule())
        def fail(point):
            if point == "prepared":
                raise SimulatedCrash("simulated stop")
        with self.assertRaises(SimulatedCrash):
            self.publish(schedule("Enroute"), fault=fail)
        self.publish(schedule("Arrived"))
        self.assertEqual(len(self.entries()), 2)
        def after(point):
            if point == "published":
                raise SimulatedCrash("simulated stop")
        with self.assertRaises(SimulatedCrash):
            self.publish(schedule("Completed"), fault=after)
        self.assertEqual(len(self.entries()), 2)
        journal.recover(self.journal)
        self.assertEqual(len(self.entries()), 3)
        self.publish(schedule("Completed"))
        self.assertEqual(len(self.entries()), 3)
    def test_uncertain_recovery_cannot_overwrite(self):
        self.publish(schedule())
        def fail(point):
            if point == "prepared":
                raise SimulatedCrash("stop")
        with self.assertRaises(SimulatedCrash):
            self.publish(schedule("Enroute"), fault=fail)
        self.target.write_text('{"uncoordinated":true}')
        self.publish(schedule("Arrived"))
        self.assertEqual(json.loads(self.target.read_text())["appointments"][0]["job_status"], "Arrived")
        self.assertTrue(list((self.journal / "gaps").glob("*.json")))
        self.assertTrue(self.entries()[-1]["batches"][0]["reset"])
    def test_complete_removal_and_unknown_source(self):
        self.publish(schedule())
        partial = schedule(); partial["territory_verification"][0]["verified"] = False
        partial["appointments"] = []
        self.publish(partial)
        self.assertEqual(len(self.entries()), 1)
        complete = schedule(); complete["appointments"] = []
        self.publish(complete)
        self.assertEqual(self.entries()[-1]["batches"][0]["observations"], [])
    def test_disabled_and_capacity(self):
        journal.publish_json(self.target, schedule(), enabled=False)
        self.assertFalse(self.journal.exists())
        self.publish(schedule())
        with patch.object(journal, "MAX_ENTRIES", 1):
            self.publish(schedule("Enroute"))
        self.assertEqual(json.loads(self.target.read_text())["appointments"][0]["job_status"], "Enroute")
        self.assertEqual(len(self.entries()), 1)
        self.assertTrue(list((self.journal / "gaps").glob("*.json")))
    def test_clock_and_native_fleet_contracts(self):
        metrics = {"date": DAY, "source_freshness": {"sources": {"junkware_employees": {"status": "current", "as_of": STAMP}}},
                   "payroll_records": [{"name": "Synthetic Person", "clock_in": "08:00", "clock_out": "09:00", "pay": 12345}]}
        batch = journal.project(Path(f"daily_metrics_{DAY}.json"), metrics)[0]
        self.assertEqual(len(batch["observations"]), 2)
        self.assertNotIn("12345", json.dumps(batch))
        metrics["source_freshness"]["sources"]["junkware_employees"]["status"] = "stale"
        self.assertEqual(journal.project(Path(f"daily_metrics_{DAY}.json"), metrics), [])
        fleet = {"date": DAY, "collection_timestamp": STAMP, "pagination_completed": True, "validation_status": "passed",
                 "alerts": [{"alert_id": "native-1", "alert_type_normalized": "geofence_exited", "truck_number": "8", "geofence_name": "Synthetic HQ", "occurred_at": STAMP}]}
        self.assertEqual(len(journal.project(Path(f"linxup_alerts_{DAY}.json"), fleet)[0]["observations"]), 1)
        fleet["pagination_completed"] = False
        self.assertEqual(journal.project(Path(f"linxup_alerts_{DAY}.json"), fleet), [])
        self.assertEqual(journal.project(Path(f"{DAY}.json"), {"date": DAY, "observations": []}), [])
    def test_identical_observation_advances_reorder_watermark(self):
        self.publish(schedule())
        later = (datetime.fromisoformat(STAMP) + timedelta(seconds=20)).isoformat()
        self.publish(schedule(at=later))
        self.publish(schedule("Enroute"))
        self.assertEqual(len(self.entries()), 1)
        self.assertTrue(list((self.journal / "gaps").glob("*.json")))
    def test_real_source_helpers(self):
        with patch.dict(os.environ, {"OPSCENTER_WEB_PUSH_CAPTURE": "1", "OPSCENTER_WEB_PUSH_JOURNAL_DIR": str(self.journal)}):
            stream = load("collect-junkware-schedule-stream")
            stream.write_snapshot(self.root, DAY, "352", "New Orleans", schedule()["appointments"], [], "https://example.invalid", observation_started_at=STAMP)
            forward = load("collect-junkware-forward-schedule")
            forward.write_json_atomic(self.target, schedule("Enroute", datetime.now(timezone.utc).isoformat()), observation_started_at=datetime.now(timezone.utc).isoformat())
            metrics = load("source_aware_metrics")
            metrics.atomic_json(self.root / f"daily_metrics_{DAY}.json", {"date": DAY, "payroll_records": [], "source_freshness": {"sources": {"junkware_employees": {"status": "current", "as_of": STAMP}}}})
        self.assertEqual(len(self.entries()), 3)
    def test_concurrent_writers_serialize(self):
        script = """
import sys
from pathlib import Path
from opscenter_push_journal import publish_json
root,day,stamp,worker=sys.argv[1:]
for revision in range(5):
 publish_json(Path(root).parent / ('junkware_schedule_fast_'+day+'.json'), {'date':day,'scraped_at':stamp,'territory_verification':[{'territory_id':'352','verified':True}],'appointments':[{'appt_id':'fixture','market':'New Orleans','job_status':worker+'-'+str(revision)}]},journal_root=root,enabled=True)
"""
        processes = [subprocess.Popen([sys.executable, "-c", script, str(self.journal), DAY, STAMP, str(worker)], env={"PATH": os.environ["PATH"], "PYTHONPATH": str(Path(__file__).parent)}) for worker in range(4)]
        self.assertEqual([process.wait(timeout=10) for process in processes], [0, 0, 0, 0])
        batches = [entry["batches"][0] for entry in self.entries()]
        self.assertEqual([batch["sequence"] for batch in batches], list(range(1, 21)))
        self.assertEqual(batches[-1]["observations"], journal.project(self.target, json.loads(self.target.read_text()))[0]["observations"])
    def test_recovery_after_ready_before_checkpoint(self):
        save = journal.save
        def interrupted(path, data):
            if path.name == "state.json":
                raise SimulatedCrash("checkpoint interrupted")
            save(path, data)
        with patch.object(journal, "save", interrupted), self.assertRaises(SimulatedCrash):
            self.publish(schedule())
        self.assertEqual(len(self.entries()), 1)
        # A consumer may already have archived the committed ready record.
        archive = self.journal / "archive"; archive.mkdir()
        entry = next((self.journal / "ready").glob("*.json"))
        entry.rename(archive / entry.name)
        journal.recover(self.journal)
        self.assertEqual(self.entries(), [])
        self.publish(schedule("Enroute"))
        self.assertEqual(self.entries()[0]["batches"][0]["sequence"], 2)
    def test_capture_fault_never_blocks_canonical_or_caller(self):
        cases = [schedule(), schedule(), []]
        cases[0]["appointments"][0].pop("appt_id")
        cases[1]["scraped_at"] = (datetime.now(timezone.utc)+timedelta(days=1)).isoformat()
        for payload in cases:
            calls = []
            self.publish(payload, publisher=lambda: (calls.append("canonical"), journal.original_json(self.target, payload)))
            calls.append("existing Slack continuation")
            self.assertEqual(calls, ["canonical", "existing Slack continuation"])
            self.assertEqual(json.loads(self.target.read_text()), payload)
        self.assertTrue(list((self.journal / "gaps").glob("*.json")))
        def broken():
            raise OSError("canonical unavailable")
        with self.assertRaisesRegex(OSError, "canonical unavailable"):
            self.publish(schedule(), publisher=broken)
    def test_lock_wait_is_bounded_and_source_continues(self):
        self.journal.mkdir()
        with (self.journal / "writer.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            started = time.monotonic()
            self.publish(schedule())
            self.assertLess(time.monotonic()-started, 0.5)
        self.assertTrue(self.target.exists())
        self.assertTrue(list((self.journal / "gaps").glob("*.json")))
    def test_raw_requested_and_competing_collection_order(self):
        raw = self.root / f"junkware_{DAY}_raw.json"
        requested = self.root / f"junkware_schedule_requested_{DAY}.json"
        journal.publish_json(raw, schedule(), enabled=True, journal_root=self.journal, observation_started_at=STAMP)
        later = (datetime.fromisoformat(STAMP)+timedelta(seconds=20)).isoformat()
        journal.publish_json(requested, schedule("Arrived", later), enabled=True, journal_root=self.journal, observation_started_at=later)
        journal.publish_json(raw, schedule("Scheduled", later), enabled=True, journal_root=self.journal, observation_started_at=STAMP)
        self.assertEqual(len(self.entries()), 2)
        self.assertTrue(list((self.journal / "gaps").glob("*.json")))
    def test_pause_gap_rebases_and_keeps_gap_visible(self):
        self.publish(schedule())
        journal.mark_gap(self.journal, ["journal:global"], "capture_disabled")
        self.publish(schedule("Arrived"))
        batch = self.entries()[-1]["batches"][0]
        self.assertTrue(batch["baseline"])
        self.assertTrue(batch["reset"])
        self.assertEqual(batch["sequence"], 1)
        self.assertNotEqual(batch["generation"], self.entries()[0]["batches"][0]["generation"])
        self.publish(schedule("Completed"))
        self.assertEqual(self.entries()[-1]["batches"][0]["sequence"], 2)
        self.assertTrue(list((self.journal / "gaps").glob("*.json")))
    def test_disabled_preserves_original_bytes_mode_callback(self):
        calls=[]
        def original():
            calls.append(1)
            self.target.write_text('{"original": true}')
            self.target.chmod(0o644)
        journal.publish_json(self.target, schedule(), enabled=False, publisher=original)
        self.assertEqual(calls, [1])
        self.assertEqual(self.target.read_text(), '{"original": true}')
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o644)
        self.assertFalse(self.journal.exists())
    def test_existing_stream_slack_continuation_after_projection_failure(self):
        stream = load("collect-junkware-schedule-stream")
        invalid = [{"market": "New Orleans", "job_status": "Scheduled"}]
        with patch.dict(os.environ, {"OPSCENTER_WEB_PUSH_CAPTURE": "1", "OPSCENTER_WEB_PUSH_JOURNAL_DIR": str(self.journal)}), patch.object(stream, "appointment_rows", return_value=invalid), patch.object(stream, "enrich_closed_charges", return_value=invalid), patch.object(stream, "cancellation_rows", return_value=[]), patch.object(stream, "publish_snapshot") as slack:
            stream.publish_market(SimpleNamespace(SCHEDULE_URL="https://example.invalid"), self.root, self.root, DAY, "352", "New Orleans", {}, STAMP)
            slack.assert_called_once()
        self.assertTrue(list((self.journal / "gaps").glob("*.json")))
    def test_new_service_day_clock_facts_are_not_silently_baselined(self):
        self.publish(schedule())
        state = json.loads((self.journal / "state.json").read_text())
        state["startedAt"] = (datetime.now(timezone.utc)-timedelta(days=2)).isoformat()
        journal.save(self.journal / "state.json", journal.encoded(state))
        metrics = {"date": DAY, "source_freshness": {"sources": {"junkware_employees": {"status": "current", "as_of": STAMP}}}, "payroll_records": [{"name": "Synthetic Person", "clock_in": "08:00"}]}
        journal.publish_json(self.root / f"daily_metrics_{DAY}.json", metrics, enabled=True, journal_root=self.journal)
        self.assertFalse(self.entries()[-1]["batches"][0]["baseline"])
    def test_bad_market_does_not_remove_good_market(self):
        payload = schedule()
        payload["appointments"][0].pop("appt_id")
        payload["appointments"].append({"appt_id": "good", "market": "Northshore", "job_status": "Scheduled"})
        payload["territory_verification"].append({"territory_id": "477", "verified": True})
        self.publish(payload)
        self.assertEqual([batch["scope"] for batch in self.entries()[0]["batches"]], [f"schedule:{DAY}:market-477"])
        self.assertTrue(list((self.journal / "gaps").glob("*.json")))
    def test_runtime_patch_guards(self):
        prepare = load("prepare-web-push-source-hooks")
        with self.assertRaises(ValueError):
            prepare.patch_fleet("unknown")
        source = 'from linxup_collection_safety import request_json, run_collector\nx = {"pagination_completed": pagination_completed}\n'
        patched = prepare.patch_fleet(source)
        self.assertEqual(patched, prepare.patch_fleet(patched))


if __name__ == "__main__":
    unittest.main()
