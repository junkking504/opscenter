import importlib.util
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile
from xml.sax.saxutils import escape

spec = importlib.util.spec_from_file_location('importer', Path(__file__).with_name('import-financial-statements.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def workbook(file, missing=False):
    cells = {'A1': 'Synthetic Test Company', 'A2': 'Profit and Loss', 'B5': 'Jan 2026', 'C5': 'Total', 'A7': 'Income', 'A8': 'Sales', 'B8': 900}
    values = [1000, 300, 700, 200, 500, 10, 20, -10, 490]
    for index, (name, _) in enumerate(module.TOTALS.items(), start=9):
        cells[f'A{index}'] = name
        if not (missing and name == 'Net Income'):
            cells[f'B{index}'] = values[index-9]
        cells[f'C{index}'] = 99999  # Total columns must never become months.
    cells['A19'] = 'Adjusted NI for manager bonus'
    cells['B19'] = 2000
    rows = []
    for ref, value in cells.items():
        body = f'<is><t>{escape(value)}</t></is>' if isinstance(value, str) else f'<v>{value}</v>'
        kind = ' t="inlineStr"' if isinstance(value, str) else ''
        rows.append(f'<row><c r="{ref}"{kind}>{body}</c></row>')
    with ZipFile(file, 'w') as z:
        z.writestr('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="P&amp;L" sheetId="1" r:id="r1"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + ''.join(rows) + '</sheetData></worksheet>')

class ImportTests(unittest.TestCase):
    def test_source_totals_and_supplemental_are_distinct(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'Synthetic DRAFT.xlsx'
            workbook(file)
            source = module.parse_workbook(file)
            self.assertEqual(len(source['records']), 1)
            record = source['records'][0]
            self.assertEqual(record['totals']['netIncome'], 49000)
            self.assertEqual(record['supplemental'][0]['cents'], 200000)
            self.assertEqual(record['basis'], 'Unspecified')
            self.assertEqual(record['status'], 'Draft')
            self.assertIn('$100.00', record['warnings'][0])
            self.assertEqual(source['sourceId'], module.parse_workbook(file)['sourceId'])

    def test_missing_total_is_not_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'Synthetic DRAFT.xlsx'
            workbook(file, missing=True)
            with self.assertRaisesRegex(ValueError, 'required P&L total'):
                module.parse_workbook(file)

if __name__ == '__main__':
    unittest.main()
