#!/usr/bin/env python3
"""Restore the exact pinned upstream binaries, verifying hashes before writing."""
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen, Request

root = Path(__file__).resolve().parent.parent
dest = root / 'public' / 'engine'
meta = json.loads((dest / 'PROVENANCE.json').read_text())
base = meta['repository'] + '/releases/download/' + meta['release'] + '/'
for name in ['slicer-mt.js', 'slicer-mt.wasm']:
    print('Downloading', name)
    request = Request(base + name, headers={'User-Agent': 'Pocket-Slicer-source-build'})
    with urlopen(request, timeout=120) as response:
        data = response.read()
    actual = hashlib.sha256(data).hexdigest()
    if actual != meta['sha256'][name]:
        raise SystemExit(f'Checksum mismatch for {name}; no replacement written.')
    if name.endswith('.wasm'):
        split = meta['wasmStorage']['splitAtBytes']
        for index, part in enumerate(meta['wasmStorage']['parts']):
            (dest / part).write_bytes(data[index*split:(index+1)*split])
    else:
        (dest / name).write_bytes(data)
print('Pinned engine restored and verified.')
