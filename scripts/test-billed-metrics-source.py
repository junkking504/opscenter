"""Execute only the existing production collector's revenue block on synthetic rows.
Usage: python3 scripts/test-billed-metrics-source.py /path/to/process_daily_metrics.py
No collector main, imports, reads, writes or provider calls are executed.
"""
import hashlib
import sys
import textwrap
from collections import defaultdict
from pathlib import Path
source = Path(sys.argv[1]).read_text()
start = source.index('    # Rebuild revenue and job totals from completed jobs.')
end = source.index('    # Correct each truck financial record', start)
block = compile(textwrap.dedent(source[start:end]), '<collector revenue block>', 'exec')
for method in ['Billed', 'Cash']:
    rows = [dict(job_status='Completed', appointment_type='Job', truck='Truck 6', territory='Fixture', revenue=350, payment_type=method),
            dict(job_status='Completed', appointment_type='Estimate', truck='Truck 6', territory='Fixture', revenue=999, payment_type='Billed'),
            dict(job_status='Confirmed', appointment_type='Job', truck='Truck 6', territory='Fixture', revenue=999, payment_type='Billed')]
    scope = dict(defaultdict=defaultdict, junkware_rows=rows, appointment_visits={},
                 first_value=lambda row, keys: next((row[k] for k in keys if row.get(k) is not None), ''),
                 money_to_float=lambda value: float(str(value).replace('$','').replace(',','') or 0),
                 gps_authoritative_truck=lambda row, visits: row['truck'])
    exec(block, scope)
    assert scope['total_revenue'] == 350
    assert scope['revenue_by_truck']['Truck 6'] == 350
    assert scope['revenue_by_market']['Fixture'] == 350
    assert scope['jobs_by_truck']['Truck 6'] == 1
    assert scope['total_payments_collected'] == (0 if method == 'Billed' else 350)
    assert scope['open_invoice_total'] == (350 if method == 'Billed' else 0)
print('PASS: existing production metrics source counts completed billed Job revenue once, separates collection/receivable, excludes estimates/open jobs. SHA256 '+hashlib.sha256(source.encode()).hexdigest())
