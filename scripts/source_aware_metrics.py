"""Source provenance and fail-closed publication for the local OpsBot processor.

Installed beside process_daily_metrics.py; contains no provider calls.
"""
import csv
import hashlib
import json
import os
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo


def timestamp(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return parsed if parsed.tzinfo else None
    except (ValueError, TypeError):
        return None


def atomic_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f'.{path.name}.{os.getpid()}.tmp')
    try:
        temporary.write_text(json.dumps(payload, indent=2) + '\n', encoding='utf-8')
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def money(value):
    text = str(value or '0').strip().replace('$', '').replace(',', '')
    try:
        amount = Decimal(text or '0')
        if not amount.is_finite():
            raise InvalidOperation
        return amount
    except InvalidOperation as exc:
        raise ValueError('Invalid completed-job revenue; publication stopped') from exc


def completed_total(rows):
    return sum((money(row.get('revenue')) for row in rows
                if 'completed' in str(row.get('job_status', '')).lower()
                and 'estimate' not in str(row.get('appointment_type', '')).lower()), Decimal(0))


def employee_key(value):
    name = ' '.join(str(value or '').split())
    if ',' in name:
        last, first = (part.strip() for part in name.split(',', 1))
        name = first if first.casefold() == last.casefold() else f'{first} {last}'
    return ' '.join(name.split()).casefold()


class SourcePublication:
    def __init__(self, root, date, now=None):
        self.root, self.date = Path(root), date
        self.now = now or datetime.now(timezone.utc)
        self.sources, self.fingerprints = {}, {}
        base = self.root / 'data/history/junkware'
        raw_path = base / f'junkware_{date}_raw.json'
        completed_path = base / f'junkware_completed_{date}_summary.csv'
        raw = json.loads(raw_path.read_text(encoding='utf-8'))
        captured = timestamp(raw.get('scraped_at'))
        verification = raw.get('territory_verification') or []
        if (raw.get('date') != date or not captured or captured > self.now
                or 'login.aspx' in json.dumps(raw).lower()
                or not isinstance(raw.get('completed'), list)
                or len(verification) != 4
                or {str(item.get('territory_id')) for item in verification} != {'352', '477', '399', '484'}
                or not all(item.get('verified') is True for item in verification)):
            raise ValueError('Unverified JunkWare date, capture, or territories; publication stopped')
        with completed_path.open(newline='', encoding='utf-8-sig') as handle:
            reader = csv.DictReader(handle)
            if not {'job_id', 'revenue', 'job_status', 'appointment_type'}.issubset(reader.fieldnames or []):
                raise ValueError('Invalid completed-job schema; publication stopped')
            self.completed_rows = list(reader)
        self.expected_revenue = completed_total(self.completed_rows)
        raw_rows = raw['completed']
        if (len(raw_rows) != len(self.completed_rows)
                or sorted(str(row.get('job_id', '')) for row in raw_rows)
                != sorted(str(row.get('job_id', '')) for row in self.completed_rows)
                or completed_total(raw_rows) != self.expected_revenue):
            raise ValueError('Completed CSV does not match verified JunkWare capture; publication stopped')
        # Include the raw capture in the read consistency check, even though it
        # is not a separate display metric.
        self.watch(raw_path)
        self.failures = self.read_failures()
        self.add('junkware_completed', completed_path, captured, 'junkware')
        self.add('junkware_employees', base / f'junkware_employees_{date}_summary.csv', captured, 'junkware')
        self.add('junkware_truck_records', base / f'junkware_truck_records_{date}.csv', captured, 'junkware')
        rates = base / f'junkware_employee_rates_{date}.csv'
        self.rate_path, self.rate_rows = rates, []
        rate_stamps = []
        if rates.exists():
            with rates.open(newline='', encoding='utf-8-sig') as handle:
                self.rate_rows = list(csv.DictReader(handle))
                rate_stamps = [timestamp(row.get('collected_at')) for row in self.rate_rows]
        rate_stamp = min(rate_stamps) if rate_stamps and all(rate_stamps) else None
        self.add('junkware_rates', rates, rate_stamp, 'junkware_timesheets', require_stamp=True)
        linxup = self.root / 'data/history/linxup'
        self.add('linxup_summary', linxup / f'linxup_{date}_summary.csv',
                 self.json_stamp(linxup / f'linxup_{date}_raw.json'), 'linxup', require_stamp=True)
        self.add('linxup_location', linxup / f'linxup_location_{date}.json',
                 self.json_stamp(linxup / f'linxup_location_{date}.json'), 'linxup_live', require_stamp=True)
        self.add('linxup_alerts', linxup / f'alerts/linxup_alerts_{date}.json',
                 self.json_stamp(linxup / f'alerts/linxup_alerts_{date}.json'), 'linxup_alerts', require_stamp=True)
        qbo = self.root / f'data/history/qbo/qbo_{date}_summary.csv'
        self.add('qbo', qbo, None, 'qbo')
        self.employee_as_of = self.sources['junkware_employees']['as_of']
        self.payroll_as_of = self.group(['junkware_completed', 'junkware_employees', 'junkware_rates'])['as_of']

    def watch(self, path):
        self.fingerprints[path] = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None

    def json_stamp(self, path):
        try:
            payload = json.loads(path.read_text(encoding='utf-8'))
            if payload.get('collection_errors') or payload.get('source_status') == 'failed':
                return None
            responses = payload.get('responses', {})
            if isinstance(responses, dict) and any(isinstance(row, dict) and row.get('error') for row in responses.values()):
                return None
            return next((stamp for key in ('scraped_at', 'collected_at', 'collection_timestamp', 'retrieved_at')
                         if (stamp := timestamp(payload.get(key)))), None)
        except (OSError, ValueError):
            return None

    def read_failures(self):
        failures = set()
        try:
            path = Path(os.environ.get('OPSCENTER_COLLECTOR_HEALTH_FILE') or self.root / 'data/health/collector_failures.json')
            failures.update(item['id'] for item in json.loads(path.read_text()).get('conditions', []))
        except (OSError, ValueError, KeyError):
            pass
        linxup = self.root / 'data/history/linxup'
        for collector, path in [
            ('linxup', linxup / f'linxup_{self.date}_status.json'),
            ('linxup_live', linxup / f'linxup_location_{self.date}_status.json'),
            ('linxup_alerts', linxup / f'alerts/linxup_alerts_{self.date}_status.json'),
        ]:
            try:
                if json.loads(path.read_text()).get('source_status') == 'failed':
                    failures.add(collector)
            except (OSError, ValueError):
                pass
        return failures

    def add(self, key, path, captured, collector, require_stamp=False):
        if key.startswith('junkware_'):
            self.watch(path)
        if not path.exists() or not path.stat().st_size:
            self.sources[key] = {'status': 'missing', 'as_of': None, 'reason': 'Source file unavailable'}
            return
        modified = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
        as_of = min(captured, modified) if captured else (None if require_stamp else modified)
        reason = None
        if not as_of:
            reason = 'Source capture timestamp unavailable'
        elif collector in self.failures:
            reason = 'Latest source collection failed; retained previous observations'
        elif as_of > self.now:
            reason = 'Source timestamp is in the future'
        elif self.date == self.now.astimezone(ZoneInfo('America/Chicago')).date().isoformat() and (self.now - as_of).total_seconds() > 600:
            reason = 'Source observation is older than ten minutes'
        self.sources[key] = {'status': 'stale' if reason else 'current', 'as_of': as_of.isoformat() if as_of else None}
        if reason:
            self.sources[key]['reason'] = reason

    def group(self, dependencies):
        items = [self.sources[key] for key in dependencies]
        stamps = [timestamp(item['as_of']) for item in items]
        status = 'missing' if any(item['status'] == 'missing' for item in items) else (
            'stale' if any(item['status'] != 'current' for item in items) else 'current')
        return {'status': status, 'as_of': min(stamps).isoformat() if stamps and all(stamps) else None,
                'dependencies': dependencies,
                **({'reason': 'One or more required inputs are unavailable or stale'} if status != 'current' else {})}

    def scope_payroll_rates(self, records):
        """Only rates used by the published payroll can block its freshness."""
        hourly = [row for row in records if not row.get('is_salary')]
        if not hourly:
            self.sources['junkware_rates'] = {
                'status': 'current', 'as_of': self.employee_as_of,
                'reason': 'No hourly rates required by this payroll'}
            return
        used, invalid = [], False
        for record in hourly:
            key = employee_key(record.get('name'))
            matches = [row for row in self.rate_rows if key and key == employee_key(
                row.get('normalized_name') or row.get('employee_name') or row.get('name'))]
            if not matches:
                self.sources['junkware_rates'] = {
                    'status': 'missing', 'as_of': None,
                    'reason': 'A payroll employee has no dated rate evidence'}
                return
            used.extend(matches)
            try:
                invalid |= (record.get('hourly_rate_source') != 'verified_current'
                            or any(row.get('status') != 'verified_current'
                                   or money(row.get('hourly_rate')) <= 0
                                   or money(row.get('hourly_rate')) != money(record.get('hourly_rate'))
                                   for row in matches))
            except ValueError:
                invalid = True
        stamps = [timestamp(row.get('collected_at')) for row in used]
        # Check every used timestamp, including a future timestamp hidden by min().
        invalid |= any(stamp and stamp > self.now for stamp in stamps)
        self.add('junkware_rates', self.rate_path,
                 min(stamps) if stamps and all(stamps) else None,
                 'junkware_timesheets', require_stamp=True)
        if invalid:
            self.sources['junkware_rates']['status'] = 'stale'
            self.sources['junkware_rates']['reason'] = 'A payroll rate is not verified current or does not match its evidence'

    def apply(self, metrics):
        # A concurrent collector must not mix two source generations.
        for path, digest in self.fingerprints.items():
            current = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
            if current != digest:
                raise ValueError(f'Source changed during processing: {path.name}; publication stopped')
        if money(metrics.get('total_revenue')) != self.expected_revenue:
            raise ValueError('Processed revenue differs from validated completed jobs; publication stopped')
        actual_employee_path = metrics.get('inputs', {}).get('junkware_employee_summary')
        expected_employee_path = f'data/history/junkware/junkware_employees_{self.date}_summary.csv'
        if actual_employee_path and actual_employee_path != expected_employee_path:
            actual_path = self.root / actual_employee_path
            self.add('junkware_employees', actual_path, self.json_stamp(actual_path), 'junkware', require_stamp=True)
            self.sources['junkware_employees']['status'] = 'stale'
            self.sources['junkware_employees']['reason'] = 'Processor used a legacy employee fallback'
        if isinstance(metrics.get('payroll_records'), list):
            self.scope_payroll_rates(metrics['payroll_records'])
        elif metrics.get('inputs', {}).get('missing_hourly_rates'):
            self.sources['junkware_rates']['status'] = 'stale'
            self.sources['junkware_rates']['reason'] = 'One or more employee rates are missing'
        dependencies = {
            'revenue': ['junkware_completed'],
            'payroll': ['junkware_completed', 'junkware_employees', 'junkware_rates'],
            'operating_costs': ['junkware_truck_records'],
            'costs': ['junkware_completed', 'junkware_employees', 'junkware_rates', 'junkware_truck_records'],
            'net': ['junkware_completed', 'junkware_employees', 'junkware_rates', 'junkware_truck_records'],
            'gps': ['linxup_summary', 'linxup_location', 'linxup_alerts'],
            'truck_revenue': ['junkware_completed', 'linxup_location'],
        }
        metrics['source_freshness'] = {'version': 1, 'published_at': self.now.isoformat(),
                                     'sources': self.sources,
                                     'metrics': {key: self.group(value) for key, value in dependencies.items()}}
        metrics['generated_at'] = self.now.isoformat()
        metrics['payroll_as_of'] = self.group(dependencies['payroll'])['as_of']
        # These fields were built before the processor knew its final payroll
        # roster. Keep their cutoff consistent with the scoped source contract.
        def update_cutoffs(value):
            if isinstance(value, dict):
                for key, child in value.items():
                    if key == 'payroll_as_of':
                        value[key] = metrics['payroll_as_of']
                    else:
                        update_cutoffs(child)
            elif isinstance(value, list):
                for child in value:
                    update_cutoffs(child)
        update_cutoffs(metrics)
        if str(metrics.get('provisional_reason', '')).startswith('Day in progress; payroll counted through '):
            metrics['provisional_reason'] = f"Day in progress; payroll counted through {metrics['payroll_as_of']}"
        return metrics
