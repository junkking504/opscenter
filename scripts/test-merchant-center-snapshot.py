import unittest
from merchant_center_snapshot import build_snapshot

class SnapshotTests(unittest.TestCase):
    csv = b'Trans ID,Date,Cardholder Name,Card No,Type,Status,Amount,Fee,Comment\np1,09/10/2026,Example Person,xxxx1234,Sale,Approved,120.00,4.20,JK4000001\n'
    def parse(self, content=None, account='Junk Krewe - #4618'):
        return build_snapshot(content or self.csv, '2026-09-10', account, '2026-09-11T16:00:00Z')
    def test_report(self):
        t=self.parse()['transactions'][0]
        self.assertEqual((t['amount'],t['cardLastFour'],t['jkNumber'],t['fee']), (120,'1234','JK4000001',4.2))
    def test_bad_identity(self):
        with self.assertRaises(ValueError): self.parse(account='Other - #4618')
        with self.assertRaises(ValueError): self.parse(self.csv.replace(b',Sale,',b',SalesReceipt,'))
        with self.assertRaises(ValueError): self.parse(self.csv.replace(b'120.00',b'NaN'))
        with self.assertRaises(ValueError): self.parse(self.csv.replace(b'120.00',b'120.001'))
    def test_duplicates(self):
        duplicate=self.csv+self.csv.splitlines()[1]+b'\n'
        self.assertEqual(len(self.parse(duplicate)['transactions']),1)
        with self.assertRaises(ValueError): self.parse(self.csv+self.csv.splitlines()[1].replace(b'120.00',b'121.00')+b'\n')
    def test_refund_preserved(self):
        t=self.parse(self.csv.replace(b',Sale,',b',Refund,').replace(b'120.00',b'(120.00)'))['transactions'][0]
        self.assertEqual(t['amount'],-120)
    def test_empty_complete_export(self):
        self.assertEqual(self.parse(self.csv.splitlines()[0]+b'\n')['transactions'],[])

if __name__=='__main__': unittest.main()
