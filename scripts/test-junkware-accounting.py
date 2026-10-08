import copy
import importlib.util
import tempfile
import unittest
from pathlib import Path
import uuid

spec=importlib.util.spec_from_file_location('accounting',Path(__file__).with_name('junkware-accounting.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def row():
    r={'appointmentId':'123','jkNumber':'JK123','date':'2026-10-02','amount':800.0,'method':'Check #1167','customer':'Test Customer','billingEmail':'','email':'test@example.invalid','crew':'Test Crew','syncStatus':'U'}
    r['key']=m.row_key(r);return r

class Source:
    def __init__(self): self.status='U';self.calls=0;self.interrupted=False;self.changed=False;self.lost=False
    def find(self,r,status):
        if self.changed: raise ValueError('Source changed')
        if status!=self.status: raise ValueError('Result not found')
        return None,r
    def submit(self,form,r,action):
        self.calls+=1
        if not self.lost: self.status='E' if action=='exclude' else 'S'
        if self.interrupted: raise RuntimeError('Response lost')
        return type('F',(),{'label':lambda self,s:'Saved'})()

class AccountingTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();m.STORE=Path(self.temp.name);self.source=Source()
        self.body={'action':'verify','requestId':str(uuid.uuid4()),'rows':[row()]}
    def tearDown(self): self.temp.cleanup()
    def run_action(self): return m.execute(self.source,self.body,'manager@example.invalid')
    def test_receive_records_manager_without_sync_or_replay(self):
        self.body['action']='receive'
        result=self.run_action()
        self.assertTrue(result['complete']);self.assertEqual(self.source.calls,0);self.assertEqual(self.source.status,'U')
        mark=m.annotations()[row()['key']]
        self.assertEqual(mark['actor'],'manager@example.invalid');self.assertFalse(mark['synced']);self.assertTrue(mark['verifiedAt'])
        self.run_action();m.execute(self.source,{'requestId':self.body['requestId']},'manager@example.invalid',True)
        self.assertEqual(self.source.calls,0)
    def test_receive_rejects_nonphysical_tenders_and_changed_source(self):
        self.body['action']='receive'
        for method in ['Billed','Credit Card x1234']:
            self.body['rows'][0]['method']=method;self.body['rows'][0]['key']=m.row_key(self.body['rows'][0])
            with self.assertRaisesRegex(ValueError,'cash and checks'): self.run_action()
        self.body['rows']=[row()];self.source.changed=True
        self.assertFalse(self.run_action()['complete']);self.assertEqual(m.annotations(),{});self.assertEqual(self.source.calls,0)
    def test_receive_synced_and_excluded_without_source_mutation(self):
        self.body['action']='receive'
        for status in ['S','E']:
            self.body['requestId']=str(uuid.uuid4());self.body['rows'][0]['syncStatus']=status;self.source.status=status
            self.assertTrue(self.run_action()['complete']);self.assertEqual(self.source.calls,0);self.assertEqual(self.source.status,status)
    def test_receive_recovery_cannot_create_attestation(self):
        self.body['action']='receive'
        r={'id':self.body['requestId'],'action':'receive','actor':'manager@example.invalid','createdAt':m.now(),'fingerprint':'test','items':[{'row':row(),'state':'pending'}]}
        m.save(m.STORE/'receipts'/f"{r['id']}.json",r)
        recovered=m.execute(self.source,{'requestId':r['id']},'manager@example.invalid',True)
        self.assertFalse(recovered['complete']);self.assertEqual(m.annotations(),{});self.assertEqual(self.source.calls,0)
    def test_verify_is_native_update_and_replay_never_submits(self):
        result=self.run_action();self.assertTrue(result['complete']);self.assertEqual(self.source.calls,1);self.assertTrue(m.annotations()[row()['key']]['synced'])
        self.run_action();self.assertEqual(self.source.calls,1)
    def test_lost_response_with_saved_result_succeeds_once(self):
        self.source.interrupted=True;result=self.run_action();self.assertTrue(result['complete']);self.assertEqual(self.source.calls,1)
    def test_uncertain_result_blocks_second_request_and_recovery_never_replays(self):
        self.source.lost=True;result=self.run_action();self.assertEqual(result['items'][0]['state'],'uncertain')
        original=self.body['requestId'];self.body['requestId']=str(uuid.uuid4())
        with self.assertRaisesRegex(ValueError,'unresolved'): self.run_action()
        recovered=m.execute(self.source,{'requestId':original},'manager@example.invalid',True)
        self.assertFalse(recovered['complete']);self.assertEqual(self.source.calls,1)
        self.source.status='S';recovered=m.execute(self.source,{'requestId':original},'manager@example.invalid',True)
        self.assertTrue(recovered['complete']);self.assertEqual(self.source.calls,1)
    def test_changed_source_never_submits_or_verifies(self):
        self.source.changed=True;result=self.run_action();self.assertEqual(result['items'][0]['state'],'failed');self.assertEqual(self.source.calls,0);self.assertEqual(m.annotations(),{})
    def test_card_not_manual_verification(self):
        self.body['rows'][0]['method']='Credit Card x1234';self.body['rows'][0]['key']=m.row_key(self.body['rows'][0])
        with self.assertRaisesRegex(ValueError,'cash and checks'): self.run_action()
    def test_already_synced_verification_does_not_resend(self):
        self.source.status='S';self.body['rows'][0]['syncStatus']='S'
        self.assertTrue(self.run_action()['complete']);self.assertEqual(self.source.calls,0)
    def test_changed_request_id_content_rejected(self):
        self.run_action();self.body['action']='exclude'
        with self.assertRaisesRegex(ValueError,'another action'): self.run_action()
    def test_exclude_preserves_separate_verification(self):
        self.body['action']='exclude';self.assertTrue(self.run_action()['complete']);self.assertEqual(self.source.status,'E');self.assertEqual(m.annotations(),{})
    def test_partial_batch_stops(self):
        other=row();other['appointmentId']='124';other['jkNumber']='JK124';other['key']=m.row_key(other);self.body['rows'].append(other)
        self.source.lost=True;result=self.run_action();self.assertEqual([i['state'] for i in result['items']],['uncertain','not_attempted']);self.assertEqual(self.source.calls,1)
    def test_browser_integer_amount_preserves_source_identity(self):
        self.body['rows'][0]['amount']=800
        self.assertTrue(self.run_action()['complete'])
    def test_recover_absent_receipt_is_terminal_without_writes(self):
        result=m.execute(self.source,{'requestId':str(uuid.uuid4())},'manager@example.invalid',True)
        self.assertEqual(result['items'],[]);self.assertEqual(self.source.calls,0)
    def test_native_background_processing_stays_pending_without_replay(self):
        self.source.lost=True
        original=self.source.submit
        def queued(form,r,action):
            original(form,r,action)
            return type('F',(),{'label':lambda self,s:'Processing 1 records into QuickBooks.'})()
        self.source.submit=queued
        self.source.find=lambda r,status: (None,r) if status=='U' else (_ for _ in ()).throw(ValueError('The selected source record is missing or ambiguous. Refresh the register.'))
        result=self.run_action();self.assertEqual(result['items'][0]['state'],'submitted')
        self.assertIn('processing',result['items'][0]['message'])
        m.execute(self.source,{'requestId':self.body['requestId']},'manager@example.invalid',True)
        self.assertEqual(self.source.calls,1)
    def test_range_validation(self):
        with self.assertRaises(ValueError): m.validate_filters({'from':'2026-10-03','to':'2026-10-02','status':'U'})
    def test_native_submission_selects_only_exact_row(self):
        captured=[];source=object.__new__(m.Source);source.request=lambda fields:captured.append(fields)
        form=type('F',(),{'fields':{'__VIEWSTATE':'private-state','ctl00$Content$StatusDD':'U'},'controls':{'ctl00$Content$UpdateQuickBooksBtn':{'value':'Update QuickBooks'}}})()
        source.submit(form,{'checkbox':'ctl00$Content$ListView1$ctrl4$SelectedCB'},'verify')
        self.assertEqual(captured[0]['ctl00$Content$SelectedRecordCountHF'],'1');self.assertEqual(captured[0]['ctl00$Content$ListView1$ctrl4$SelectedCB'],'on');self.assertFalse(any('SelectAll' in key for key in captured[0]))
    def test_parser_requires_complete_money_and_identity(self):
        html='<select name="ctl00$Content$StatusDD"><option selected value="U">Unsynced</option></select><tr id="x_ItemRow"><td><input type="checkbox" name="row1"></td><td>10/02/2026</td><td><a href="appointment.aspx?id=123">JK123</a></td><td>$800.00</td><td>Check #1167</td><td>Test Customer</td><td></td><td>test@example.invalid</td><td>Test Crew</td></tr>'
        self.assertEqual(m.Form(html).rows[0]['key'],row()['key'])
        with self.assertRaises(ValueError): m.Form(html.replace('$800.00','Unavailable'))

if __name__=='__main__': unittest.main()
