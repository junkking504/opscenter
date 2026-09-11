"""Validate and normalize read-only Merchant Center evidence independently of QBO."""
import csv
import io
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation


def money(value, optional=False):
    s = str(value or '').strip().replace('$', '').replace(',', '')
    if optional and not s:
        return None
    if s.startswith('(') and s.endswith(')'):
        s = '-' + s[1:-1]
    try:
        n = Decimal(s)
        if not n.is_finite() or n != n.quantize(Decimal('0.01')):
            raise ValueError('Invalid cent amount in Merchant Center export.')
        return float(n)
    except InvalidOperation as error:
        raise ValueError('Invalid amount in Merchant Center export.') from error


def build_snapshot(content, target_date, account_label, observed_at, complete=True):
    if not re.search(r'junk\s+krewe', account_label, re.I) or not account_label.strip().endswith('4618'):
        raise ValueError('Expected Junk Krewe Merchant Center account ending 4618.')
    datetime.fromisoformat(observed_at.replace('Z', '+00:00'))
    datetime.strptime(target_date, '%Y-%m-%d')
    reader = csv.DictReader(io.StringIO(content.decode('utf-8-sig')))
    if not {'Trans ID', 'Date', 'Card No', 'Amount'}.issubset(set(reader.fieldnames or [])):
        raise ValueError('Unrecognized Merchant Center CSV; no evidence was replaced.')
    transactions = {}
    for row in reader:
        raw_date = str(row.get('Date') or '').split(' ')[0]
        try:
            day = datetime.strptime(raw_date, '%m/%d/%Y').date().isoformat()
        except ValueError:
            day = datetime.strptime(raw_date, '%Y-%m-%d').date().isoformat()
        if day != target_date:
            continue
        # QBO exports must never masquerade as independent processor evidence.
        kind = str(row.get('Type') or row.get('Transaction Type') or '').strip()
        if kind.lower() in ('payment', 'salesreceipt'):
            raise ValueError('This is a QBO accounting export, not Merchant Center evidence.')
        tid = str(row.get('Trans ID') or '').strip()
        if not tid or not kind:
            raise ValueError('Transaction ID or type missing from Merchant Center export.')
        comment = str(row.get('Comment') or row.get('Memo') or '')
        jobs = set(re.findall(r'\bJK\d{6,9}\b', comment.upper()))
        card_digits = re.sub(r'\D', '', str(row.get('Card No') or ''))
        transaction = {
            'date': day, 'transactionId': tid, 'amount': money(row.get('Amount')),
            'cardLastFour': card_digits[-4:] if len(card_digits) >= 4 else '',
            'customer': str(row.get('Cardholder Name') or '').strip(),
            'jkNumber': next(iter(jobs)) if len(jobs) == 1 else '',
            'status': str(row.get('Status') or row.get('Response') or 'Unknown').strip(),
            'transactionType': kind, 'fee': money(row.get('Fee'), optional=True), 'observedAt': observed_at,
        }
        if tid in transactions and transactions[tid] != transaction:
            raise ValueError('Conflicting duplicate Merchant Center transaction ID.')
        transactions[tid] = transaction
    return {'schema': 1, 'date': target_date, 'collector': 'merchant-center-export',
            'accountName': 'Junk Krewe', 'accountLastFour': '4618', 'collectedAt': observed_at,
            'complete': complete, 'transactions': list(transactions.values())}
