import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('backfill', Path(__file__).with_name('collect-finance-yoy-history.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
dates = module.collection_dates('2025-09-06')
assert len(dates) == 249 and len(set(dates)) == 249
assert dates[:6] == [f'2025-09-{d:02d}' for d in range(1, 7)]
assert dates[6] == '2025-08-01' and dates[-1] == '2025-01-31'
assert len(module.collection_dates('2024-03-01')) == 61
raw = {'date':'2025-09-01','markets_scraped':['a','b','c','d'],'territory_verification':[{'territory_id':key,'verified':True} for key in ['352','477','399','484']]}
module.verify_raw(raw, '2025-09-01')
for bad in [{**raw,'date':'2026-09-01'}, {**raw,'territory_verification':[]}, {**raw,'territory_verification':raw['territory_verification'][:3]}, {**raw,'territory_verification':[{'territory_id':'352','verified':False}]}]:
    try: module.verify_raw(bad, '2025-09-01')
    except ValueError: pass
    else: raise AssertionError('Unverified history accepted')
print('YOY history ordering, cutoff, leap year and source verification passed.')
