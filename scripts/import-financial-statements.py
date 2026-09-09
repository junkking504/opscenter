#!/usr/bin/env python3
"""Import cached P&L values from accountant XLSX exports; never execute formulas.

Uses Python's standard library. Original workbooks and normalized records stay
outside Git. Re-imports are idempotent by SHA256; revisions remain separate.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from zipfile import ZipFile
import xml.etree.ElementTree as ET

TOTALS = {
    'Total for Income': 'income', 'Total for Cost of Goods Sold': 'cogs',
    'Gross Profit': 'grossProfit', 'Total for Expenses': 'expenses',
    'Net Operating Income': 'operatingIncome', 'Total for Other Income': 'otherIncome',
    'Total for Other Expenses': 'otherExpenses', 'Net Other Income': 'netOtherIncome',
    'Net Income': 'netIncome',
}

def cents(value):
    if value is None or value == '':
        return None
    return int((Decimal(str(value)) * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))

def read_sheet(file):
    with ZipFile(file) as z:
        if sum(i.file_size for i in z.infolist()) > 50_000_000:
            raise ValueError('Workbook is too large.')
        strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            strings = [''.join(n.itertext()) for n in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        book = ET.fromstring(z.read('xl/workbook.xml'))
        # Namespace identifiers come from the document; no network resolution.
        ns = {'s': book.tag.split('}')[0].lstrip('{')}
        sheets = book.find('s:sheets', ns)
        sheet = next((s for s in sheets if s.attrib['name'] == 'P&L'), None)
        if sheet is None:
            raise ValueError('Expected a P&L worksheet.')
        rels = {r.attrib['Id']: r.attrib['Target'] for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        relationship_id = next(v for k, v in sheet.attrib.items() if k.endswith('}id'))
        target = rels[relationship_id]
        target = target.lstrip('/') if target.startswith('/') else 'xl/' + target
        cells = {}
        for c in ET.fromstring(z.read(target)).findall('.//s:sheetData/s:row/s:c', ns):
            raw = c.findtext('s:v', default=None, namespaces=ns)
            kind = c.get('t')
            if kind == 's':
                value = strings[int(raw)]
            elif kind == 'inlineStr':
                value = ''.join(c.find('s:is', ns).itertext())
            elif kind in ('str', 'e'):
                value = raw
            else:
                value = float(raw) if raw is not None else None
            cells[c.attrib['r']] = {'value': value, 'formula': c.findtext('s:f', namespaces=ns), 'error': kind == 'e'}
        return cells, [s.attrib['name'] for s in sheets]

def parse_workbook(file):
    cells, sheets = read_sheet(file)
    value = lambda ref: cells.get(ref, {}).get('value')
    company = str(value('A1') or '').strip()
    if not company or value('A2') != 'Profit and Loss':
        raise ValueError('Company name and Profit and Loss title are required.')
    columns = {}
    for ref, cell in cells.items():
        if not re.fullmatch(r'[A-Z]+[56]', ref):
            continue
        match = re.fullmatch(r'([A-Za-z]{3}) (20\d{2})', str(cell['value']))
        if match:
            month = datetime.strptime(match[0], '%b %Y').strftime('%Y-%m')
            columns[re.sub(r'\d+', '', ref)] = month
    if not columns:
        raise ValueError('No explicit monthly amount columns found.')
    digest = hashlib.sha256(file.read_bytes()).hexdigest()
    basis = 'Accrual' if any('Accrual Basis' in str(c['value']) for c in cells.values()) else 'Cash' if any('Cash Basis' in str(c['value']) for c in cells.values()) else 'Unspecified'
    label_rows = sorted(int(re.sub(r'\D', '', ref)) for ref in cells if re.fullmatch(r'A\d+', ref))
    end_row = next(r for r in label_rows if value(f'A{r}') == 'Net Income')
    records = []
    for col, month in columns.items():
        rows, notes, totals, warnings = [], [], {}, []
        for r in label_rows:
            if r < 7:
                continue
            label = str(value(f'A{r}') or '').strip()
            if not label or 'Basis ' in label:
                continue
            ref = f'{col}{r}'
            cell = cells.get(ref, {})
            raw = cell.get('value')
            amount = cents(raw) if isinstance(raw, (int, float)) else None
            row = {'label': label, 'cents': amount, 'cell': ref, 'formula': cell.get('formula')}
            if cell.get('error') or (cell.get('formula') and amount is None):
                warnings.append(f'{ref}: formula result unavailable in saved workbook.')
            if r <= end_row:
                rows.append(row)
                if label in TOTALS:
                    totals[TOTALS[label]] = amount
            else:
                notes.append(row)
        if any(totals.get(key) is None for key in TOTALS.values()):
            raise ValueError(f'{month}: a required P&L total has no numeric saved value.')
        for name, actual, expected in [
            ('Gross profit', totals['grossProfit'], totals['income'] - totals['cogs']),
            ('Operating income', totals['operatingIncome'], totals['grossProfit'] - totals['expenses']),
            ('Net other income', totals['netOtherIncome'], totals['otherIncome'] - totals['otherExpenses']),
            ('Net income', totals['netIncome'], totals['operatingIncome'] + totals['netOtherIncome']),
        ]:
            if abs(actual - expected) > 1:
                warnings.append(f'{name} differs from supporting totals by ${(actual - expected)/100:,.2f}.')
        income_detail = []
        for row in rows:
            if row['label'] == 'Total for Income':
                break
            if row['cents'] is not None:
                income_detail.append(row['cents'])
        if income_detail and abs(totals['income'] - sum(income_detail)) > 1:
            warnings.append(f"Income detail differs from stated income by ${(totals['income'] - sum(income_detail))/100:,.2f}; source total retained.")
        # Text annotations are evidence, never executable instructions.
        annotations = [{'cell': ref, 'text': c['value']} for ref, c in cells.items()
                       if isinstance(c['value'], str) and ref.startswith(('D', 'E'))
                       and int(re.sub(r'\D', '', ref)) > 6 and c['value'].strip()]
        records.append({'id': f'{digest}:{month}', 'sourceId': digest, 'sourceKind': 'workbook',
                        'company': company, 'month': month, 'reportThrough': max(columns.values()),
                        'basis': basis, 'status': 'Draft' if 'draft' in file.name.lower() else 'Unreviewed',
                        'sourceName': file.name, 'sheet': 'P&L', 'totals': totals, 'rows': rows,
                        'supplemental': notes, 'annotations': annotations, 'warnings': warnings})
    return {'sourceId': digest, 'sourceName': file.name, 'sheets': sheets, 'records': records}

def atomic_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile(mode='w', dir=file.parent, delete=False) as f:
        json.dump(value, f, indent=2, allow_nan=False)
        tmp = f.name
    os.chmod(tmp, 0o600)
    os.replace(tmp, file)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('files', nargs='+', type=Path)
    parser.add_argument('--output-dir', type=Path, default=Path.home() / 'Library/Application Support/OpsCenter/financial-statements')
    parser.add_argument('--apply', action='store_true', help='Save normalized snapshots and preserve original workbooks outside Git.')
    args = parser.parse_args()
    if (Path(__file__).resolve().parents[1] == args.output_dir.resolve() or Path(__file__).resolve().parents[1] in args.output_dir.resolve().parents):
        parser.error('Financial data must be stored outside the source checkout.')
    parsed = [parse_workbook(file) for file in args.files]
    if len({r['company'] for p in parsed for r in p['records']}) != 1:
        parser.error('Import one company at a time.')
    for file, data in zip(args.files, parsed):
        if args.apply:
            directory = args.output_dir / 'sources'
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            original = directory / f"{data['sourceId']}.xlsx"
            if not original.exists():
                shutil.copyfile(file, original)
                os.chmod(original, 0o600)
            atomic_json(args.output_dir / f"{data['sourceId']}.json", {**data, 'schemaVersion': 1, 'importedAt': datetime.now(timezone.utc).isoformat()})
        print(json.dumps({'source': file.name, 'applied': args.apply, 'months': [{'month': r['month'], 'status': r['status'], 'warnings': r['warnings']} for r in data['records']]}))

if __name__ == '__main__':
    main()
