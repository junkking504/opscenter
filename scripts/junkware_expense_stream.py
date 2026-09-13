"""Read individual truck expenses in the existing authenticated collector session."""
import math
import hashlib
import json
import re
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ZONE = ZoneInfo('America/Chicago')
URL = 'https://junkware.junk-king.com/franchise/accounting/truck-records.aspx'
LAST_ATTEMPT = {}
DETAIL_JS = r'''() => {
 const text = el => (el?.textContent || '').replace(/\s+/g,' ').trim();
 const tables = [...document.querySelectorAll('table')];
 const table = tables.find(t => [...t.querySelectorAll('tr')].some(r => {
   const h=[...r.children].map(text); return h.includes('Category') && h.includes('Time') && h.includes('Location') && h.includes('Amount');
 }));
 const headings=[...document.querySelectorAll('h4')].map(text).filter(t=>/^Truck\s*#?\s*\d+$/i.test(t));
 return {url:location.href, date:document.getElementById('ctl00_Content_DateTB')?.value,
 market:document.getElementById('ctl00_Content_ServiceProviderGroupDD')?.value,
 truck:headings.length===1?headings[0]:'', found:Boolean(table),
 rows:table?[...table.querySelectorAll('tr')].map(r=>[...r.children].map(text)).filter(c=>/^(Dumps?|Gas|Fuel)$/i.test(c[0])):[]};
}'''


def normalize_entries(detail, date, market, truck):
    if (detail.get('url', '').split('?')[0] != URL or detail.get('date') != datetime.fromisoformat(date).strftime('%m/%d/%Y')
            or str(detail.get('market')) != str(market) or detail.get('truck') != truck or not detail.get('found')):
        raise ValueError('Expense date, market, truck or table did not verify')
    result, occurrences = [], {}
    for row in detail.get('rows', []):
        if len(row) != 5:
            raise ValueError('Expense row is incomplete')
        category, clock, receipt, location, amount = row
        kind = 'dump' if re.fullmatch('dumps?', category, re.I) else 'fuel'
        stamp = datetime.strptime(f'{date} {clock}', '%Y-%m-%d %I:%M %p').replace(tzinfo=ZONE).isoformat()
        value = float(re.sub(r'[$,\s]', '', amount))
        if not math.isfinite(value) or value <= 0:
            raise ValueError('Expense amount must be positive')
        # Same-time duplicate rows stay distinct. Amount corrections update the
        # same event; changes to time/location are different source entries.
        identity = json.dumps([date,str(market),truck,kind,clock,receipt,location], separators=(',', ':'))
        occurrences[identity] = occurrences.get(identity, 0)+1
        key = hashlib.sha256(f'{identity}:{occurrences[identity]}'.encode()).hexdigest()[:32]
        result.append(dict(id=key,date=date,market=str(market),truck=truck,kind=kind,transactionAt=stamp,receipt=receipt,location=location,amount=value))
    return result


def collect_expense_entries(collector, data_dir, date, market):
    """At most one truck detail per market/minute; never navigate the schedule tab.

    Changed totals take priority; unchanged details recheck after five minutes.
    Failures preserve the last verified snapshot and do not emit partial entries.
    """
    key = (str(data_dir), date, str(market))
    if time.monotonic()-LAST_ATTEMPT.get(key, -1e10) < 60:
        return
    LAST_ATTEMPT[key] = time.monotonic()
    root = Path(data_dir)/'history'/'junkware'/'expenses'/date/str(market)
    original, page = collector.page, None
    try:
        page = original.context.new_page()
        page.set_default_timeout(8000)
        page.set_default_navigation_timeout(8000)
        collector.page = page
        page.goto(URL, wait_until='domcontentloaded', timeout=8000)
        collector.postback_group(date, str(market))
        summary = collector.evaluate(collector._JS_TRUCK_RECORDS)
        if summary.get('url', '').split('?')[0] != URL or str(summary.get('group')) != str(market) or summary.get('date') != datetime.fromisoformat(date).strftime('%m/%d/%Y'):
            raise ValueError('Expense summary identity did not verify')
        candidates = []
        for row in summary.get('trucks', []):
            truck = row.get('truck', '')
            match = re.fullmatch(r'Truck# (\d+)', truck)
            if not match:
                continue
            target = root/f'{match[1]}.json'
            try:
                old = json.loads(target.read_text())
            except (OSError, ValueError):
                old = {}
            signature = [str(row.get(field, '')) for field in ('dumps', 'gas')]
            if not any(re.search(r'[1-9]', v) for v in signature) and not old.get('entries'):
                target.parent.mkdir(parents=True, exist_ok=True)
                temporary = target.with_suffix('.tmp')
                temporary.write_text(json.dumps(dict(date=date,market=str(market),truck=truck,observedAt=datetime.now(ZONE).isoformat(),verified=True,signature=signature,entries=[])))
                temporary.replace(target)
                continue
            age = time.time()-datetime.fromisoformat(old['observedAt']).timestamp() if old.get('observedAt') else 1e10
            if old.get('signature') == signature and age < 300:
                continue
            candidates.append((old.get('signature') == signature, old.get('observedAt', ''), truck, target, signature))
        if not candidates:
            return
        _, _, truck, target, signature = sorted(candidates)[0]
        cell = page.get_by_role('cell', name=truck, exact=True)
        if cell.count() != 1:
            raise ValueError('Expense truck row is ambiguous')
        cell.click()
        page.get_by_role('heading', name=truck, exact=True).wait_for(state='visible', timeout=8000)
        entries = normalize_entries(collector.evaluate(DETAIL_JS), date, market, truck)
        try:
            prior = json.loads(target.read_text())
        except (OSError, ValueError):
            prior = {}
        old_entries = {entry['id']:entry for entry in prior.get('entries', [])}
        for entry in entries:
            old_entry = old_entries.get(entry['id'])
            entry['notify'] = old_entry.get('notify', False) if old_entry else bool(prior.get('verified'))
        stamp = datetime.now(ZONE).isoformat()
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix('.tmp')
        temporary.write_text(json.dumps(dict(date=date,market=str(market),truck=truck,observedAt=stamp,verified=True,signature=signature,entries=entries), indent=2))
        temporary.replace(target)
    finally:
        collector.page = original
        if page is not None:
            page.close()
