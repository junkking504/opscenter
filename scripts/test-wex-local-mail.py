import datetime as dt
from email.message import EmailMessage
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('wex_local_mail',Path(__file__).with_name('collect-wex-local-mail.py'))
mail=importlib.util.module_from_spec(spec);spec.loader.exec_module(mail)


class WexMailTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.account='synthetic-account';self.mailbox='synthetic@example.invalid'
        self.now=dt.datetime(2026,10,25,tzinfo=dt.timezone.utc)
        self.accounts=self.root/'Accounts.sqlite'
        with sqlite3.connect(self.accounts) as db:
            db.execute('create table ZACCOUNT(ZIDENTIFIER text,ZUSERNAME text)');db.execute('insert into ZACCOUNT values(?,?)',(self.account,self.mailbox))
        (self.root/'MailData').mkdir();(self.root/self.account).mkdir()
        with sqlite3.connect(self.root/'MailData/Envelope Index') as db:
            db.executescript('create table messages(mailbox integer,sender integer,date_received real,deleted integer); create table mailboxes(url text); create table addresses(address text);')
            db.execute('insert into mailboxes values(?)',('ews://'+self.account+'/Inbox',));db.execute('insert into addresses values(?)',(mail.SENDER,))

    def tearDown(self): self.tmp.cleanup()

    def add(self,rid=1,rfc='<fixture@example.invalid>',sender=mail.SENDER,plain='',html=True):
        msg=EmailMessage();msg['From']=sender;msg['Message-ID']=rfc;msg.set_content(plain)
        if html:
            msg.add_alternative('<html><script>secret script</script><table><tr><td>Tracking Number:</td><td>12345</td></tr><tr><td>Reason:</td><td>A $80.00 Fuel purchase has exceeded your alert value.</td></tr><tr><td>Authorization Date &amp; Time:</td><td>10/24/2026 10:00:00</td></tr><tr><td>Units:</td><td>20</td></tr><tr><td>Units of Measure:</td><td>GA</td></tr><tr><td>Card Number:</td><td>NEVER-COPY</td></tr></table></html>',subtype='html')
        raw=msg.as_bytes();file=self.root/self.account/(str(rid)+'.emlx');file.write_bytes(str(len(raw)).encode()+b'\n'+raw+b'\nmetadata')
        with sqlite3.connect(self.root/'MailData/Envelope Index') as db:db.execute('insert into messages(rowid,mailbox,sender,date_received,deleted) values(?,1,1,?,0)',(rid,(self.now-dt.timedelta(hours=12)).timestamp()))
        return file

    def scan(self):return mail.scan(self.account,self.mailbox,self.root,self.accounts,self.now)

    def test_empty_plain_uses_html_and_minimizes(self):
        self.add();packet,gaps=self.scan();self.assertEqual(gaps,[]);self.assertEqual(len(packet['messages']),1)
        body=packet['messages'][0]['body'];self.assertIn('Tracking Number: 12345',body);self.assertIn('Units: 20',body)
        self.assertNotIn('NEVER-COPY',body);self.assertNotIn('secret script',body);self.assertEqual(packet['sources'][0]['internetMessageId'],'<fixture@example.invalid>')
        self.assertEqual(self.scan()[0],packet)

    def test_missing_body_is_gap_not_empty_success(self):
        self.add().unlink();packet,gaps=self.scan();self.assertEqual(packet['messages'],[]);self.assertEqual(len(gaps),1)

    def test_missing_or_wrong_source_identity_fails(self):
        self.add(sender='untrusted@example.invalid');self.assertEqual(len(self.scan()[1]),1)
        with self.assertRaisesRegex(ValueError,'approved_account_mismatch'):mail.scan(self.account,'other@example.invalid',self.root,self.accounts,self.now)

    def test_native_repeated_delivery_deduplicates(self):
        self.add();self.add(2);packet,gaps=self.scan();self.assertEqual(len(packet['messages']),1);self.assertEqual(gaps,[])

    def test_conflicting_native_identity_reaches_guarded_importer(self):
        self.add();self.add(2,plain='Tracking Number: 12345\nReason: A $90.00 Fuel purchase has exceeded your alert value.\nAuthorization Date & Time: 10/24/2026 10:00:00\nUnits: 20\nUnits of Measure: GA')
        packet,gaps=self.scan();self.assertEqual(len(packet['messages']),2);self.assertEqual(packet['messages'][0]['id'],packet['messages'][1]['id']);self.assertEqual(gaps[0]['reason'],'duplicate_native_identity_conflict')

    def test_future_or_empty_messages_are_visible_gaps(self):
        self.add(html=False)
        self.assertEqual(len(self.scan()[1]),1)
        with sqlite3.connect(self.root/'MailData/Envelope Index') as db:db.execute('update messages set date_received=?',((self.now+dt.timedelta(days=1)).timestamp(),))
        self.assertEqual(self.scan()[1][0]['reason'],'future_received_time')

    def test_read_only_and_sender_scope(self):
        self.add();database=self.root/'MailData/Envelope Index';before=database.read_bytes();self.scan();self.assertEqual(database.read_bytes(),before)
        with sqlite3.connect(database) as db:db.execute('update addresses set address=?',('someone@example.invalid',))
        self.assertEqual(self.scan(),({'messages':[],'sources':[]},[]))


if __name__=='__main__':unittest.main()
