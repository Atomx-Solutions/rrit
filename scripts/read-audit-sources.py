"""Print bounded, numbered source batches and record which snapshots were inspected."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
inventory = json.loads((ROOT / 'docs/deep-audit-file-inventory.json').read_text())
# Security/backend first, then user flows, tests, static UI and supporting configuration.
def order(item):
    p = item['path']
    rank = (0 if '/server/utils/' in p else 1 if '/server/api/' in p else
            2 if '/database/' in p or '/shared/' in p else 3 if '/tests/' in p else
            4 if '/app/components/' in p else 5 if '/app/pages/' in p else 6)
    return rank, p
batches = [[]]
size = 0
for item in sorted(inventory, key=order):
    # Include every first-party source file; large files form their own batch.
    if size and size + item['bytes'] > 19000:
        batches.append([])
        size = 0
    batches[-1].append(item)
    size += item['bytes']
if len(sys.argv) == 1:
    print(json.dumps([{ 'batch':i, 'files':[x['path'] for x in b], 'bytes':sum(x['bytes'] for x in b)} for i,b in enumerate(batches)]))
    sys.exit(0)
index = int(sys.argv[1])
record = ROOT / 'docs/deep-audit-read-coverage.json'
coverage = json.loads(record.read_text()) if record.exists() else {}
for item in batches[index]:
    p = ROOT / item['path']
    text = p.read_text(encoding='utf-8-sig')
    print('\nFILE ' + item['path'])
    for line, content in enumerate(text.splitlines(), 1):
        if content.strip():
            print(f'{line}: {content.strip()}')
    coverage[item['path']] = {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(), 'lines':len(text.splitlines()), 'batch':index}
record.write_text(json.dumps(coverage,indent=2),encoding='utf-8')
