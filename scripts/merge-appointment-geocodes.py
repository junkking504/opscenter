"""Atomic compare-and-merge bridge for the address agent; JSON stays on stdin."""
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent / 'runtime'))
from geocode_cache_transaction import merge_geocode_cache

if __name__ == '__main__':
    value = json.load(sys.stdin)
    merge_geocode_cache(Path(sys.argv[1]), value['baseline'], value['proposal'])
