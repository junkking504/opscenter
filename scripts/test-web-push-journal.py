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
    def test_exact_canonical_market_names_for_all_verified_scopes(self):
        for market, name in journal.MARKETS.items():
            payload = schedule()
            payload['territory_verification'] = [{'territory_id': market, 'verified': True}]
            payload['appointments'][0]['market'] = 'Junk King ' + name
            payload['appointments'][0]['territory'] = 'Different geographic territory'
            batches = journal.project(self.target, payload)
            self.assertEqual([batch['scope'] for batch in batches], [f'schedule:{DAY}:market-{market}'])
            self.assertEqual(len(batches[0]['observations']), 1)
    def test_market_label_alias_change_is_not_an_operational_event(self):
        self.publish(schedule())
        canonical = schedule(); canonical['appointments'][0]['market'] = 'Junk King New Orleans'
        self.publish(canonical)
        self.assertEqual(len(self.entries()), 1)
    def test_unknown_market_does_not_fall_back_to_geographic_territory(self):
        payload = schedule(); payload['appointments'][0].update(market='Unverified New Orleans alias', territory='New Orleans')
        self.assertEqual(journal.project(self.target, payload), [])
        payload['appointments'][0]['market'] = 'Junk King New Orleans'
        payload['territory_verification'][0]['verified'] = False
        self.assertEqual(journal.project(self.target, payload), [])
    def test_burst_order_dedup_and_reversion(self):
        for status in ["Scheduled", "Enroute", "Arrived", "Completed", "Scheduled"]:
            self.publish(schedule(status))
        self.publish(schedule())
        batches = [entry["batches"][0] for entry in self.entries()]
        self.assertEqual([b["sequence"] for b in batches], [1, 2, 3, 4, 5])
        self.assertEqual([(x["identity"], x["revision"]) for x in batches[0]["observations"]], [(x["identity"], x["revision"]) for x in batches[-1]["observations"]])
        self.assertEqual(json.loads(self.target.read_text())["appointments"][0]["job_status"], "Scheduled")
        self.assertIn("synthetic-job", batches[-1]["observations"][0]["notification"]["body"])
        self.assertIn("Completed → Scheduled", batches[-1]["observations"][0]["notification"]["body"])
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
    def test_raw_fleet_archive_does_not_interrupt_normalized_capture(self):
        raw = self.root / "alerts" / "raw" / f"linxup_alerts_{DAY}.json"
        normalized = raw.parent.parent / raw.name
        archive = {"date": DAY, "collection_timestamp": STAMP, "response": {"alerts": []}}
        fleet = {"date": DAY, "collection_timestamp": STAMP, "pagination_completed": True,
                 "validation_status": "passed", "collection_errors": [], "alerts": []}
        self.assertEqual(journal.source_scopes(raw, archive), [])
        self.assertEqual(journal.project(raw, archive), [])
        for _ in range(2):
            journal.publish_json(raw, archive, journal_root=self.journal, enabled=True)
            journal.publish_json(normalized, fleet, journal_root=self.journal, enabled=True)
        self.assertEqual(json.loads(raw.read_text()), archive)
        self.assertEqual(len(self.entries()), 1)
        self.assertEqual(list((self.journal / "gaps").glob("*.json")), [])
        # A malformed normalized feed must still report missing coverage.
        journal.publish_json(normalized, archive, journal_root=self.journal, enabled=True)
        self.assertEqual(len(list((self.journal / "gaps").glob("*.json"))), 1)

    def test_descriptions_do_not_change_fact_identity_or_create_format_events(self):
        payload = schedule()
        payload['appointments'][0]['customer_name'] = 'Synthetic Customer'
        self.publish(payload)
        second = schedule('Enroute');second['appointments'][0]['customer_name'] = 'Synthetic Customer'
        self.publish(second)
        description = self.entries()[-1]['batches'][0]['observations'][0]['notification']
        self.assertIn('Synthetic Customer', description['body'])
        self.assertIn('Scheduled → Enroute', description['body'])
        second['appointments'][0]['customer_name'] = 'Corrected Display'
        self.publish(second)
        batches = [entry['batches'][0] for entry in self.entries()]
        self.assertEqual(batches[-1]['observations'][0]['revision'], batches[-2]['observations'][0]['revision'])
        self.assertIn('Corrected Display', batches[-1]['observations'][0]['notification']['body'])

    def test_fleet_notification_normalizes_labels_without_changing_facts(self):
        local = (datetime.now(journal.ZoneInfo("America/Chicago")) - timedelta(days=1)).replace(hour=17, minute=21, second=0, microsecond=0)
        day = local.date().isoformat()
        at = local.astimezone(timezone.utc).isoformat()
        labels = [9, "9", "#9", "# 9", "Truck 9", "Truck# 9", "Truck #9",
                  " Truck # 9 ", "tRuCk# 9", "Truck #Truck# 9", "Truck Truck ## 9", "Truck9", "Truck#Truck9"]
        for label in labels:
            for kind, action in [("geofence_exited", "Departed"), ("geofence_entered", "Arrived")]:
                with self.subTest(label=label, kind=kind):
                    row = {"alert_id": "synthetic-truck-event", "alert_type_normalized": kind,
                           "truck_number": label, "geofence_name": "Warehouse", "occurred_at": at}
                    payload = {"date": day, "collection_timestamp": at, "pagination_completed": True,
                               "validation_status": "passed", "alerts": [row]}
                    item = journal.project(Path(f"linxup_alerts_{day}.json"), payload)[0]["observations"][0]
                    self.assertEqual(item["notification"], {"title": "Truck #9", "body": f"{action}{' at' if kind == 'geofence_entered' else ''} Warehouse: 5:21 PM\nDate: {day} (Central)"})
                    expected = journal.observation(row["alert_id"], {key: row.get(key) for key in
                        ("alert_type_normalized", "alert_type", "truck_number", "geofence_name", "occurred_at", "duration_seconds")})
                    self.assertEqual({key: item[key] for key in expected}, expected)
                    self.assertEqual(row["truck_number"], label)
                    self.assertEqual(journal.truck_notification_title(item["notification"]["title"]), "Truck #9")
        self.assertEqual(journal.truck_notification_title("Truckster"), "Truck #Truckster")
        self.assertEqual(journal.truck_notification_title("Truck #09"), "Truck #09")

    def test_schedule_multiline_details_and_private_context(self):
        payload = schedule()
        row = payload['appointments'][0]
        row.update(job_id='JK12345', customer_name='Synthetic Customer', appointment_time='12:00 PM - 01:00 PM',
                   assigned_truck='Truck# 4', appointment_type='Estimate', revenue='$0.00',
                   address='123 Synthetic Street', phone='555-0100')
        self.publish(payload)
        item = self.entries()[-1]['batches'][0]['observations'][0]
        notification = item['notification']
        self.assertTrue(notification['body'].startswith(f'Date: {DAY}\nTime: 12:00 PM - 01:00 PM (Central)\nJob: JK12345\n'))
        for detail in ['Customer: Synthetic Customer', 'Truck: #4', 'Status: Scheduled', 'Type: Estimate', 'Address: 123 Synthetic Street', 'Phone: 555-0100']:
            self.assertIn(detail, notification['body'])
        for unwanted in [' · ', 'End: unassigned', 'Recorded amount:', 'synthetic-job', '**', 'from OpsCenter']:
            self.assertNotIn(unwanted, notification['body'])
        self.assertEqual(notification['schedule']['date'], DAY)
        self.assertEqual(notification['schedule']['truck'], 'Truck #4')
        self.assertEqual(item['identity'], journal.digest('synthetic-job'), 'JK display label never changes canonical identity')
        row.update(appointment_type='Job', revenue='$125.50', job_status='Cancelled')
        self.publish(payload)
        notification = self.entries()[-1]['batches'][0]['observations'][0]['notification']
        self.assertEqual(notification['title'], 'Cancelled')
        self.assertIn('Recorded amount: $125.50', notification['body'])
        prior_revision = self.entries()[-1]['batches'][0]['observations'][0]['revision']
        row.update(revenue='$150.00')
        self.publish(payload)
        self.assertEqual(self.entries()[-1]['batches'][0]['observations'][0]['revision'], prior_revision, 'display amount does not add business events')

    def test_schedule_preserves_separate_end_and_normalizes_truck_changes(self):
        payload = schedule()
        row = payload['appointments'][0]
        row.update(appointment_time='12:00 PM', end_time='01:00 PM', assigned_truck='Truck# 9')
        self.publish(payload)
        notification = self.entries()[-1]['batches'][0]['observations'][0]['notification']
        self.assertEqual(notification['schedule']['time'], '12:00 PM - 01:00 PM')
        self.assertIn('Time: 12:00 PM - 01:00 PM (Central)', notification['body'])
        row.update(assigned_truck='Truck# 4', end_time='02:00 PM')
        self.publish(payload)
        notification = self.entries()[-1]['batches'][0]['observations'][0]['notification']
        self.assertEqual(notification['schedule']['time'], '12:00 PM - 02:00 PM')
        self.assertIn('Changed truck: #9 → #4', notification['body'])
        self.assertEqual(set(notification['schedule']['changedFields']), {'truck', 'end'})
        self.assertNotIn('Truck#', notification['body'])

    def test_completion_detail_template_and_unchanged_event_facts(self):
        payload = schedule()
        row = payload['appointments'][0]
        row.update(job_id='JK12345', customer_name='Synthetic Customer', appointment_type='Job', truck='Truck# 4')
        self.publish(payload)
        before = self.entries()[-1]['batches'][0]['observations'][0]
        row.update(job_status='Completed Duration: 60 min(s)', truck='Truck# 3', revenue='$200.00', payment_type='Billed',
                   closeout={'loadSize': '.5 (1/12)', 'loadQuantity': '', 'total': '$200.00', 'balance': '0.00',
                             'payments': [{'method': 'Billed', 'amount': '$200.00', 'detail': 'private reference'}]})
        self.publish(payload)
        item = self.entries()[-1]['batches'][0]['observations'][0]
        self.assertEqual(item['notification']['title'], 'Truck #3')
        self.assertEqual(item['notification']['body'], 'Job Completed\nJK12345 — Synthetic Customer\n1/12 load\n$200.00\nBilled')
        self.assertEqual(item['identity'], before['identity'])
        for unwanted in ('paid', 'collected', 'Duration', 'private reference', 'synthetic-job'):
            self.assertNotIn(unwanted, item['notification']['body'])
        revision = item['revision']
        row['closeout']['loadSize'] = '1 (1/6)'
        self.publish(payload)
        detail_update = self.entries()[-1]['batches'][0]['observations'][0]
        self.assertEqual(detail_update['revision'], revision, 'display-only charge detail does not create another business event')
        self.assertTrue(detail_update['notification']['body'].startswith('Completed Job Updated\n'))
        row['job_status'] = 'Completed Duration: 61 min(s)'
        self.publish(payload)
        self.assertTrue(self.entries()[-1]['batches'][0]['observations'][0]['notification']['body'].startswith('Completed Job Updated\n'))

    def test_completed_job_price_excludes_tip_but_retains_job_fees(self):
        payload = schedule(); row = payload['appointments'][0]
        row.update(job_id='JK12345', customer_name='Synthetic Customer', appointment_type='Job', truck='Truck# 6')
        self.publish(payload)
        row.update(job_status='Completed Duration: 60 min(s)', revenue='$370.80', tip='', payment_type='Credit Card',
                   closeout={'loadSize':'1 (1/6)', 'loadQuantity':'', 'loadPrice':'$300.00',
                             'otherCharges':[{'name':'Additional item','total':'$60.00'},
                                             {'name':'CC Surcharge (Card Present)','total':'$10.80'}],
                             'tip':'$37.08', 'total':'$407.88',
                             'payments':[{'method':'Credit Card','amount':'$407.88'}]})
        row['closeout_signature'] = [str(row.get(key, '')) for key in ('truck','appointment_type','job_status','revenue','tip')]
        self.publish(payload)
        item = self.entries()[-1]['batches'][0]['observations'][0]
        self.assertEqual(item['notification']['title'], 'Truck #6')
        self.assertEqual(item['notification']['body'], 'Job Completed\nJK12345 — Synthetic Customer\n1/6 load\n$370.80\nCredit Card')
        revision = item['revision']
        row['closeout']['payments'][0]['amount'] = '$200.00'
        self.publish(payload)
        later = self.entries()[-1]['batches'][0]['observations'][0]
        self.assertEqual(later['revision'], revision, 'tender enrichment must not create a completion event')
        self.assertEqual(later['notification']['body'].splitlines()[-2:], ['$370.80', 'Credit Card'])

    def test_completion_price_normalizes_only_recorded_tip(self):
        cases = [
            ({'revenue':'100', 'closeout':{'total':'110', 'tip':'10'}}, '$100.00'),
            ({'revenue':'100', 'tip':'', 'closeout':{'total':'110', 'tip':'10'}}, '$100.00'),
            ({'revenue':'100', 'tip':'10', 'closeout':{'total':'110'}}, '$100.00'),
            ({'revenue':'100', 'tip':'10', 'closeout':{'total':'100', 'tip':'0'}}, '$100.00'),
            ({'revenue':'100', 'closeout':{'total':'120', 'tip':'10'}}, ''),
            ({'revenue':'0', 'closeout':{'total':'5', 'tip':'5'}}, '$0.00'),
            ({'closeout':{'total':'110', 'tip':'10'}}, '$100.00'),
            ({'closeout':{'total':'100', 'tip':''}}, '$100.00'),
            ({'closeout':{'total':'100', 'tip':'Not available'}}, ''),
            ({'closeout':{'total':'100', 'tip':'-5'}}, ''),
            ({'closeout':{'total':'100', 'tip':'101'}}, ''),
            ({'closeout':{'payments':[{'method':'Credit Card','amount':'110'}]}}, ''),
            ({'revenue':'100', 'closeout':{'total':'invalid', 'tip':'10'}}, '$100.00'),
            ({'revenue':'100', 'closeout_refresh_pending':True, 'closeout':{'total':'200','tip':'10'}}, '$100.00'),
        ]
        for row, expected in cases:
            with self.subTest(row=row):
                self.assertEqual(journal.completion_details(row)['price'], expected)
        estimate = {'appointment_type':'Estimate', 'revenue':'100',
                    'closeout':{'total':'110','tip':'10','payments':[{'method':'Billed','amount':'110'}]}}
        self.assertEqual(journal.completion_details(estimate)['price'], '$100.00')
        self.assertEqual(journal.completion_details(estimate)['payment'], 'Billed')

    def test_completed_estimate_unknown_load_price_and_payment(self):
        payload = schedule(); row = payload['appointments'][0]
        row.update(appointment_type='Job', truck='3')
        self.publish(payload)
        row.update(job_status='Completed Duration: 60 min(s)', appointment_type='Estimate', revenue='$1,287.50',
                   closeout={'loadSize':'2', 'loadQuantity':'2', 'total':'$1,287.50', 'payments':[]})
        self.publish(payload)
        item = self.entries()[-1]['batches'][0]['observations'][0]
        self.assertEqual(item['notification']['body'], 'Estimate Completed\nsynthetic-job\nCrew: Not verified\nLoad: Not verified (size not verified)\nLabor: Not verified\nTotal: $1,287.50\nArrival: Not verified\nDeparture: Not verified\nPhotos: Not verified')
        self.assertNotIn('JKsynthetic-job', item['notification']['body'])
        self.assertEqual(journal.completion_details({'closeout': {'loadSize':'3 (1/2)', 'loadQuantity':'2', 'total':'$100.00', 'payments':[{'method':'Credit Card','amount':'$100.00','detail':'private'}]}}),
                         {'load':'2 full loads + 1/2 load','price':'$100.00','payment':'Credit Card'})
        self.assertEqual(journal.completion_details({'revenue':'$200.00','closeout':{'total':'$100.00'}})['price'], '')
        for flag in ('detail_collection_error', 'closeout_refresh_pending'):
            self.assertEqual(journal.completion_details({flag:True,'closeout':{'loadSize':'1 (1/6)','total':'$100.00'}}), {'load':'','price':'','payment':''})
        self.assertEqual(journal.completion_details({'closeout_signature':[], 'closeout':{'loadSize':'1 (1/6)','total':'$100.00'}})['load'], '')
        self.assertEqual(journal.completion_details({'closeout':{'payments':[{'method':'Cash'},{'method':'Billed'}]}})['payment'], 'Billed')

    def test_estimate_template_from_verified_closeout_and_visits(self):
        payload = schedule(); row = payload['appointments'][0]
        row.update(job_id='JK12345', customer_name='Synthetic Customer', appointment_type='Estimate', truck='Truck# 9',
                   crew_assignment_status='verified', driver_name='First, Alex', navigator_name='Second, Sam')
        self.publish(payload)
        row.update(job_status='Completed', revenue='$583.00', photos=['/system/aspnet/local/media/fixture.jpg'],
                   closeout={'loadSize':'3 (1/2)','loadPrice':'508.00','total':'583.00','payments':[],
                             'otherCharges':[{'name':'Labor','total':'75.00'}]})
        intervals=[{'arrival':'2026-01-15T22:34:13Z','departure':'2026-01-15T22:47:27Z','duration':'13.2 min'}]
        with patch.object(journal, 'confirmed_intervals', return_value=intervals):
            self.publish(payload)
        item = self.entries()[-1]['batches'][0]['observations'][0]
        self.assertEqual(item['notification'], {'title':'Truck #9',
          'body':'Estimate Completed\nJK12345 — Synthetic Customer\nAlex First  |  Sam Second\nLoad: $508.00 (1/2)\nLabor: $75.00\nTotal: $583.00\nArrival: 4:34 PM\nDeparture: 4:47 PM\nPhotos: 1 available in OpsCenter',
          'schedule':item['notification']['schedule']})
        self.assertNotIn('fixture.jpg', json.dumps(item))
        self.assertNotIn('Paid', item['notification']['body'])
        self.assertEqual(journal.photo_count({'photos':['https://evil.test/private.jpg','/system/aspnet/local/media/a.jpg','/system/aspnet/local/media/a.jpg']}), 1)
        self.assertIsNone(journal.photo_count({'photos':[], 'detail_collection_error':'missing'}))
        for alias in ('name', 'label', 'description'):
            row['closeout']['otherCharges']=[{alias:'Labor','total':'75.00'}]
            self.assertEqual(journal.completion_details(row)['labor'], '$75.00')
        row['closeout']['otherCharges']=[{'total':'75.00'}]
        self.assertEqual(journal.completion_details(row)['labor'], '')
        row['closeout']['otherCharges']=[{'name':'Card surcharge','total':'37.50'}]
        row['closeout']['discount']='10.00'
        self.assertEqual(journal.completion_details(row)['charges'], ['Card surcharge: $37.50','Discount: $10.00'])
        row['closeout']['otherCharges']=[{'name':'Labor','total':'invalid'}]
        self.assertEqual(journal.completion_details(row)['labor'], '')

    def test_confirmed_visit_display_rejects_ambiguous_or_invented_times(self):
        day=(datetime.now(journal.ZoneInfo('America/Chicago'))-timedelta(days=1)).date().isoformat()
        start=day+'T16:34:13-05:00'; end=day+'T16:47:27-05:00'
        row={'appt_id':'fixture','job_id':'JK12345','truck':'Truck# 9'}
        visit={'appointment_id':'fixture','jk_number':'JK12345','truck_number':'9','match_confidence':'confirmed',
               'visit_intervals':[{'arrival':start,'departure':end,'departure_confirmed':True,'onsite_minutes':13.23}]}
        get=lambda visits:journal.confirmed_intervals(row,visits,day,STAMP)
        self.assertEqual(get([visit]),[{'arrival':start,'departure':end,'duration':'13.2 min'}])
        for field in ('pass_by_only','operational_confirmation','conflict','supersededAt','departureBounds'):
            self.assertEqual(get([{**visit,field:True}]),[])
        self.assertEqual(get([{**visit,'jk_number':'JK999'}]),[])
        self.assertEqual(get([{**visit,'appointment_id':'sibling'}]),[])
        self.assertEqual(get([{**visit,'truck_number':'4'}]),[])
        unconfirmed={**visit,'visit_intervals':[{**visit['visit_intervals'][0],'departure_confirmed':False}]}
        self.assertEqual(get([unconfirmed])[0]['departure'],'')
        self.assertEqual(get([unconfirmed,visit]),get([visit]),'stale open copy cannot erase confirmed closure')
        missing={**visit,'visit_intervals':[{'arrival':start,'departure':end}]}
        self.assertEqual(get([missing])[0]['duration'],'','never derive GPS minutes from timestamp subtraction')
        conflict={**visit,'visit_intervals':[{'arrival':start,'departure':day+'T17:00:00-05:00'}]}
        self.assertEqual(get([visit,conflict]),[])
        overlap={**visit,'visit_intervals':[{'arrival':day+'T16:35:00-05:00','departure':end}]}
        self.assertEqual(get([visit,overlap]),[])
        fallback={**visit,'visit_intervals':[],'first_arrival':start,'final_departure':end,'visit_count':2}
        self.assertEqual(get([fallback]),[])
        fallback['visit_count']=1
        self.assertEqual(get([fallback])[0]['departure'],end)

    def test_related_snapshot_is_bounded_fresh_local_evidence_only(self):
        day=datetime.now(journal.ZoneInfo('America/Chicago')).date().isoformat()
        root=self.root/'history';path=root/'junkware'/f'junkware_{day}_raw.json'
        target=root/'linxup'/'appointment_visits'/f'linxup_appointment_visits_{day}.json'
        target.parent.mkdir(parents=True)
        payload={'date':day,'collection_timestamp':STAMP,'visits':[]}
        target.write_text(json.dumps(payload))
        self.assertEqual(journal.related_snapshot(path,day,'visits'),payload)
        payload['collection_timestamp']=(datetime.now(timezone.utc)-timedelta(minutes=20)).isoformat()
        target.write_text(json.dumps(payload)); self.assertIsNone(journal.related_snapshot(path,day,'visits'))
        target.write_text('invalid'); self.assertIsNone(journal.related_snapshot(path,day,'visits'))
        target.unlink();target.symlink_to(self.root/'missing');self.assertIsNone(journal.related_snapshot(path,day,'visits'))

    def test_full_load_quantity_is_added_to_partial_not_multiplied(self):
        for size, quantity, expected in [('3 (1/2)','0','1/2 load'),('3 (1/2)','2','2 full loads + 1/2 load'),
             ('','2','2 full loads'),('Bag(s)','3','3 bags'),('Dry Run','2','Dry Run'),('2','2','')]:
            self.assertEqual(journal.completion_details({'closeout':{'loadSize':size,'loadQuantity':quantity}})['load'],expected)
        details=journal.completion_details({'appointment_type':'Estimate','closeout':{'loadSize':'3 (1/2)','loadQuantity':'0','loadPrice':'100','bedloadSize':'1 (1/4)','bedloadQuantity':'0','bedloadPrice':'50'}})
        self.assertEqual(details['estimateLoad'],'$150.00 (1/2 load + Bedload: 1/4 bedload)')

    def test_clock_out_uses_same_final_current_pay_record(self):
        day = (datetime.now(journal.ZoneInfo('America/Chicago')) - timedelta(days=1)).date().isoformat()
        row = {'name':'Synthetic Person','clock_out':'06:45 PM','pay_is_final':True,'is_salary':False,'payroll_as_of':STAMP,
               'total_pay':196, 'hourly_pay':156, 'tip':0, 'total_bonus':40, 'supplemental_daily_pay':0}
        payload = {'date':day,'payroll_as_of':STAMP,'source_freshness':{'sources':{'junkware_employees':{'status':'current','as_of':STAMP}},
                   'metrics':{'payroll':{'status':'current','as_of':STAMP}}},'payroll_records':[row]}
        path = Path(f'daily_metrics_{day}.json')
        first = journal.project(path,payload)[0]['observations'][0]
        self.assertEqual(first['notification'], {'title':'Krewe','body':'Synthetic Person clocked out: 6:45 PM\nTotal pay: $196.00\nHourly pay: $156.00\nTips: $0.00\nBonuses: $40.00'})
        self.assertEqual(first['revision'], journal.observation(['synthetic person','out'],'06:45 PM')['revision'])
        row['pay_is_final'] = False
        unknown = journal.project(path,payload)[0]['observations'][0]
        self.assertEqual(unknown['revision'],first['revision'],'pay-only changes never duplicate clock-out')
        self.assertIn('Total pay: Not verified', unknown['notification']['body'])
        self.assertNotIn('$196.00', unknown['notification']['body'])
        row['pay_is_final'] = True; row['tip'] = None
        self.assertIn('Tips: Not verified', journal.project(path,payload)[0]['observations'][0]['notification']['body'])
        row['tip'] = 0; row['total_pay'] = 999
        self.assertIn('Total pay: Not verified', journal.project(path,payload)[0]['observations'][0]['notification']['body'])
        row['total_pay'] = 196; row['employee_total_earnings'] = 206; row['supplemental_daily_pay'] = 10
        body = journal.project(path,payload)[0]['observations'][0]['notification']['body']
        self.assertIn('Total pay: $206.00',body);self.assertTrue(body.endswith('Supplemental pay: $10.00'))
        payload['source_freshness']['metrics']['payroll']['status'] = 'stale'
        self.assertIn('Total pay: Not verified',journal.project(path,payload)[0]['observations'][0]['notification']['body'])
        payload['source_freshness']['metrics']['payroll']['status'] = 'current'
        row['payroll_as_of'] = day+'T12:00:00-05:00'
        self.assertIn('Total pay: Not verified',journal.project(path,payload)[0]['observations'][0]['notification']['body'])

    def test_clock_and_native_fleet_contracts(self):
        metrics = {"date": DAY, "source_freshness": {"sources": {"junkware_employees": {"status": "current", "as_of": STAMP}}},
                   "payroll_records": [{"name": "Synthetic Person", "clock_in": "08:00", "clock_out": "09:00", "pay": 12345}]}
        batch = journal.project(Path(f"daily_metrics_{DAY}.json"), metrics)[0]
        self.assertEqual(len(batch["observations"]), 2)
        self.assertEqual(batch["observations"][0]["notification"], {"title": "Krewe", "body": "Synthetic Person clocked in: 8:00 AM"})
        self.assertEqual(batch["observations"][1]["notification"]["body"], "Synthetic Person clocked out: 9:00 AM\nTotal pay: Not verified\nHourly pay: Not verified\nTips: Not verified\nBonuses: Not verified")
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
        self.assertEqual([x["identity"] for x in batches[-1]["observations"]], [x["identity"] for x in journal.project(self.target, json.loads(self.target.read_text()))[0]["observations"]])
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
        self.assertTrue(list((self.journal / "pending").glob("*.json")))
        journal.drain_pending(self.journal)
        self.assertEqual(len(self.entries()), 1)
        self.assertFalse(list((self.journal / "gaps").glob("*.json")))
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
        journal.mark_gap(self.journal, [f"schedule:{DAY}:market-352"], "capture_disabled")
        self.publish(schedule("Arrived"))
        batch = self.entries()[-1]["batches"][0]
        self.assertFalse(batch["baseline"])
        self.assertTrue(batch["reconcile"])
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
    def test_identical_overlapping_raw_does_not_reset_next_transition(self):
        self.publish(schedule())
        later = (datetime.fromisoformat(STAMP)+timedelta(seconds=20)).isoformat()
        self.publish(schedule("Enroute", later))
        raw = self.root / f"junkware_{DAY}_raw.json"
        journal.publish_json(raw, schedule("Enroute", later), enabled=True, journal_root=self.journal, observation_started_at=STAMP)
        self.publish(schedule("Arrived", (datetime.fromisoformat(STAMP)+timedelta(seconds=30)).isoformat()))
        self.assertEqual([b["batches"][0]["sequence"] for b in self.entries()], [1, 2, 3])
        self.assertFalse(self.entries()[-1]["batches"][0]["baseline"])
        self.assertFalse(list((self.journal / "gaps").glob("*.json")))
    def test_conflicting_overlap_retains_evidence_and_next_change(self):
        self.publish(schedule())
        later = (datetime.fromisoformat(STAMP)+timedelta(seconds=20)).isoformat()
        self.publish(schedule("Enroute", later))
        raw = self.root / f"junkware_{DAY}_raw.json"
        journal.publish_json(raw, schedule("Completed", later), enabled=True, journal_root=self.journal, observation_started_at=STAMP)
        self.assertEqual(len(list((self.journal / "uncertain").glob("*.json"))), 1)
        self.publish(schedule("Arrived", (datetime.fromisoformat(STAMP)+timedelta(seconds=30)).isoformat()))
        last = self.entries()[-1]["batches"][0]
        self.assertFalse(last["baseline"])
        self.assertFalse(last["reset"])
        self.assertEqual(last["sequence"], 3)
    def test_contended_transitions_survive_restart_and_replay(self):
        self.publish(schedule())
        with (self.journal / "writer.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.publish(schedule("Enroute"))
            self.publish(schedule("Arrived"))
        self.assertEqual(len(list((self.journal / "pending").glob("*.json"))), 2)
        subprocess.run([sys.executable, str(Path(journal.__file__)), "--recover", str(self.journal)], check=True)
        self.assertEqual(len(self.entries()), 3)
        journal.drain_pending(self.journal)
        self.assertEqual(len(self.entries()), 3)
        self.assertTrue(all(not entry["batches"][0]["baseline"] for entry in self.entries()[1:]))
    def test_gap_overflow_does_not_reset_unrelated_source(self):
        self.publish(schedule())
        journal.mark_gap(self.journal, [f"krewe:2025-01-01:x{i}" for i in range(1001)], "contract_violation")
        self.publish(schedule("Enroute"))
        self.assertFalse(journal.gap_file(self.journal, "journal:global").exists())
        self.assertTrue(journal.gap_file(self.journal, "journal:capacity").exists())
        self.assertFalse(self.entries()[-1]["batches"][0]["baseline"])
    def test_out_of_window_does_not_allocate_gaps(self):
        old = (datetime.now(timezone.utc)-timedelta(days=30)).date().isoformat()
        payload = schedule();payload["date"] = old
        journal.publish_json(self.root / f"junkware_{old}_raw.json", payload, enabled=True, journal_root=self.journal)
        self.assertFalse(self.journal.exists())
    def test_pending_commit_interruption_is_idempotent(self):
        self.publish(schedule())
        with (self.journal / "writer.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.publish(schedule("Enroute"))
        save = journal.save
        def crash(path, data):
            if path.name == "state.json":
                raise SimulatedCrash()
            save(path, data)
        with patch.object(journal, "save", crash), self.assertRaises(SimulatedCrash):
            journal.drain_pending(self.journal)
        journal.drain_pending(self.journal)
        self.assertEqual(len(self.entries()), 2)
        self.assertEqual(list((self.journal / "pending").glob("*.json")), [])
    def test_missing_detail_placeholders_cannot_clear_verified_assignment(self):
        full = schedule();full["appointments"][0].update(driver="Synthetic Driver", crew_assignment_status="verified")
        self.publish(full)
        self.publish(schedule())
        self.assertEqual(len(self.entries()), 1)
        full["appointments"][0]["driver"] = "Different Driver"
        self.publish(full, observation_started_at=datetime.now(timezone.utc).isoformat())
        self.assertEqual(len(self.entries()), 2)
        self.assertFalse(self.entries()[-1]["batches"][0]["baseline"])
    def test_malformed_pending_does_not_poison_restart(self):
        self.publish(schedule())
        with (self.journal / "writer.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.publish(schedule("Enroute"))
        (self.journal / "pending" / "00000000000000000000-invalid.json").write_text("{bad")
        journal.drain_pending(self.journal)
        self.assertEqual(len(self.entries()), 2)
        self.assertEqual(len(list((self.journal / "pending-quarantine").glob("*.json"))), 1)
        journal.drain_pending(self.journal)
        self.assertEqual(len(self.entries()), 2)
    def test_historical_first_seen_clock_is_identified_without_live_alert(self):
        self.publish(schedule())
        state = json.loads((self.journal / "state.json").read_text())
        state["startedAt"] = (datetime.now(timezone.utc)-timedelta(days=4)).isoformat()
        journal.save(self.journal / "state.json", journal.encoded(state))
        old = (datetime.now(timezone.utc)-timedelta(days=2)).date().isoformat()
        metrics = {"date": old, "source_freshness": {"sources": {"junkware_employees": {"status": "current", "as_of": STAMP}}}, "payroll_records": [{"name": "Synthetic Person", "clock_in": "08:00"}]}
        journal.publish_json(self.root / f"daily_metrics_{old}.json", metrics, enabled=True, journal_root=self.journal)
        batch = self.entries()[-1]["batches"][0]
        self.assertTrue(batch["baseline"])
        self.assertEqual(batch["baselineReason"], "historical_first_seen")
    def retirement_fixture(self):
        self.publish(schedule())
        cutoff = (datetime.now(timezone.utc)-timedelta(days=14)).date().isoformat()
        old = (datetime.now(timezone.utc)-timedelta(days=15)).date().isoformat()
        scope = f"fleet:{old}"
        state = json.loads((self.journal / "state.json").read_text())
        state["scopes"][scope] = {"generation": "a"*32, "sequence": 3}
        journal.save(self.journal / "state.json", journal.encoded(state))
        journal.mark_gap(self.journal, [scope], "capture_failure")
        return cutoff, {"scope": scope, "generation": "a"*32, "sequence": 3}
    def test_retirement_requires_matching_ack_and_preserves_boundary(self):
        cutoff, ack = self.retirement_fixture()
        self.assertEqual(journal.retire_scopes(self.journal, cutoff, [{**ack, "sequence": 2}]), [])
        self.assertEqual(journal.retire_scopes(self.journal, ack["scope"].split(":")[1], [ack]), [])
        self.assertEqual(journal.retire_scopes(self.journal, cutoff, [ack]), [ack["scope"]])
        state = json.loads((self.journal / "state.json").read_text())
        self.assertEqual(state["retiredBefore"], cutoff)
        self.assertNotIn(ack["scope"], state["scopes"])
        self.assertFalse(journal.gap_file(self.journal, ack["scope"]).exists())
        # Filesystem completion followed by DB rollback is safe to retry.
        self.assertEqual(journal.retire_scopes(self.journal, cutoff, [ack]), [ack["scope"]])
        projection = {"scope": ack["scope"], "category": "fleet", "complete": True, "observedAt": STAMP, "observations": [{"identity": "a"*64, "revision": "b"*64}]}
        self.assertEqual(journal.select_batches(self.journal, state, [projection], "owner", STAMP, STAMP), [])
    def test_retirement_retains_every_unacknowledged_reference(self):
        for directory in ("ready", "pending", "quarantine", "pending-quarantine", "uncertain"):
            with self.subTest(directory=directory):
                cutoff, ack = self.retirement_fixture()
                target = self.journal / directory / "retained.json"
                target.parent.mkdir(exist_ok=True)
                target.write_text(json.dumps({"batches": [{"scope": ack["scope"]}]}))
                self.assertEqual(journal.retire_scopes(self.journal, cutoff, [ack]), [])
                self.assertTrue(journal.gap_file(self.journal, ack["scope"]).exists())
                target.unlink()
                self.assertEqual(journal.retire_scopes(self.journal, cutoff, [ack]), [ack["scope"]])
    def test_retirement_unknown_evidence_retained_without_reviving_old_scope(self):
        cutoff, ack = self.retirement_fixture()
        target = self.journal / "quarantine" / "unknown.json"
        target.parent.mkdir(exist_ok=True);target.write_text("{bad")
        self.assertEqual(journal.retire_scopes(self.journal, cutoff, [ack]), [ack["scope"]])
        self.assertTrue(target.exists())
        self.assertEqual(json.loads((self.journal / "retention-audit.json").read_text())["unscopableRetained"], 1)
    def test_quarantine_counts_against_capture_admission(self):
        self.publish(schedule())
        quarantine = self.journal / "quarantine";quarantine.mkdir()
        first = next((self.journal / "ready").glob("*.json"));first.replace(quarantine / first.name)
        with patch.object(journal, "MAX_ENTRIES", 1):
            self.publish(schedule("Arrived"))
        self.assertEqual(json.loads(self.target.read_text())["appointments"][0]["job_status"], "Arrived")
        self.assertEqual(self.entries(), [])
        self.assertEqual(len(list(quarantine.glob("*.json"))), 1)
    def group_capture(self, state, end, start, driver=None, status="Scheduled"):
        def t(seconds):
            return (datetime.now(timezone.utc)-timedelta(seconds=seconds)).isoformat()
        payload = schedule(status, t(end+1))
        if driver is not None:
            payload["appointments"][0].update(driver=driver, navigator="Navigator", crew_assignment_status="verified")
        self.journal.mkdir(exist_ok=True)
        projected = journal.project(self.target, payload)
        return journal.select_batches(self.journal, state, projected, "full" if driver else "stream", t(start), t(end))
    def test_six_unchanged_full_refreshes_have_no_uncertain_growth(self):
        state = {"scopes": {}, "startedAt": STAMP}
        first = self.group_capture(state, 900, 901)
        self.assertTrue(first[0]["baseline"])
        seeded = self.group_capture(state, 890, 950, "Driver A")
        self.assertEqual(len(seeded[0]["silentIdentities"]), 1)
        for n in range(6):
            self.group_capture(state, 800-n*50, 801-n*50)
            self.assertEqual(self.group_capture(state, 790-n*50, 850-n*50, "Driver A"), [])
        self.assertEqual(list((self.journal / "uncertain").glob("*.json")), [])
        self.assertEqual(list((self.journal / "gaps").glob("*.json")), [])
        changed = self.group_capture(state, 400, 460, "Driver B")
        self.assertEqual(len(changed), 1)
        self.assertFalse(changed[0]["silentIdentities"])
        self.assertFalse(changed[0]["baseline"])
        self.assertEqual(self.group_capture(state, 390, 391), [])
    def test_conflicts_are_group_scoped_deduplicated_and_do_not_hide_other_changes(self):
        state = {"scopes": {}, "startedAt": STAMP}
        self.group_capture(state, 900, 901, "Driver A")
        self.group_capture(state, 800, 801, status="Enroute")
        # Page conflict does not prevent a properly ordered crew change.
        result = self.group_capture(state, 790, 850, "Driver B", status="Scheduled")
        self.assertEqual(len(result), 1)
        with patch.object(journal, "MAX_ENTRIES", 1):
            for n in range(6):
                self.group_capture(state, 780-n, 850, "Driver B", status="Scheduled")
        self.assertEqual(len(list((self.journal / "uncertain").glob("*.json"))), 1)
        # Different crew conflicts against its own detail interval, not the stream.
        self.group_capture(state, 770, 850, "Driver C", status="Enroute")
        self.assertEqual(len(list((self.journal / "uncertain").glob("*.json"))), 2)
        changed = self.group_capture(state, 760, 761, status="Arrived")
        self.assertEqual(len(changed), 1)
        self.assertFalse(changed[0]["baseline"])
    def test_counted_expiry_keeps_pending_and_current_evidence(self):
        cutoff, ack = self.retirement_fixture();ack["discardWithheld"] = True
        for directory in ("uncertain", "quarantine", "pending-quarantine"):
            p = self.journal / directory / "old.json";p.parent.mkdir(exist_ok=True);p.write_text(json.dumps({"scope": ack["scope"]}))
        current = self.journal / "uncertain" / "current.json";current.write_text(json.dumps({"scope": "fleet:"+cutoff}))
        pending = self.journal / "pending" / "held.json";pending.parent.mkdir();pending.write_text(json.dumps({"scope": ack["scope"]}))
        self.assertEqual(journal.retire_scopes(self.journal, cutoff, [ack]), [])
        self.assertTrue((self.journal / "uncertain" / "old.json").exists())
        pending.unlink()
        self.assertEqual(journal.retire_scopes(self.journal, cutoff, [ack]), [ack["scope"]])
        audit = json.loads((self.journal / "retention-audit.json").read_text())
        self.assertEqual(audit["expired"], {"uncertain": 1, "quarantine": 1, "pending-quarantine": 1})
        self.assertTrue(current.exists())
        journal.retire_scopes(self.journal, cutoff, [ack])
        self.assertEqual(json.loads((self.journal / "retention-audit.json").read_text())["expired"], audit["expired"])
        self.assertEqual(json.loads((self.journal / "state.json").read_text())["retiredScopeCount"], 1)
    def test_expiry_interruption_counts_once_and_finishes_on_restart(self):
        cutoff, ack = self.retirement_fixture();ack["discardWithheld"] = True
        target = self.journal / "uncertain" / "old.json";target.parent.mkdir();target.write_text(json.dumps({"scope": ack["scope"]}))
        save = journal.save
        def crash(path, data):
            if path.name == "retention-audit.json":
                raise SimulatedCrash()
            save(path, data)
        with patch.object(journal, "save", crash), self.assertRaises(SimulatedCrash):
            journal.retire_scopes(self.journal, cutoff, [ack])
        self.assertFalse(target.exists())
        self.assertTrue((self.journal / "expiry-intent.json").exists())
        journal.retire_scopes(self.journal, cutoff, [ack])
        self.assertEqual(json.loads((self.journal / "retention-audit.json").read_text())["expired"], {"uncertain": 1})
        self.assertFalse((self.journal / "expiry-intent.json").exists())
    def test_missing_verified_detail_fields_preserve_known_facts(self):
        state = {"scopes": {}, "startedAt": STAMP}
        self.group_capture(state, 900, 901, "Driver A")
        payload = schedule(at=(datetime.now(timezone.utc)-timedelta(seconds=800)).isoformat())
        payload["appointments"][0]["crew_assignment_status"] = "verified"
        projected = journal.project(self.target, payload)
        result = journal.select_batches(self.journal, state, projected, "full", (datetime.now(timezone.utc)-timedelta(seconds=801)).isoformat(), (datetime.now(timezone.utc)-timedelta(seconds=799)).isoformat())
        self.assertEqual(result, [])
    def test_expiry_cannot_discard_a_mixed_current_day_record(self):
        cutoff, ack = self.retirement_fixture();ack["discardWithheld"] = True
        target = self.journal / "quarantine" / "mixed.json";target.parent.mkdir()
        target.write_text(json.dumps({"batches": [{"scope": ack["scope"]}, {"scope": "fleet:"+cutoff}]}))
        self.assertEqual(journal.retire_scopes(self.journal, cutoff, [ack]), [])
        self.assertTrue(target.exists())
    def test_runtime_patch_guards(self):
        prepare = load("prepare-web-push-source-hooks")
        with self.assertRaises(ValueError):
            prepare.patch_fleet("unknown")
        source = 'from linxup_collection_safety import request_json, run_collector\nx = {"pagination_completed": pagination_completed}\n'
        patched = prepare.patch_fleet(source)
        self.assertEqual(patched, prepare.patch_fleet(patched))


if __name__ == "__main__":
    unittest.main()
