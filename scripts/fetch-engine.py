#!/usr/bin/env python3
"""Restore the pinned engine and verify the complete JS/WASM pair before writing."""
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.request import urlopen, Request

root = Path(__file__).resolve().parent.parent
dest = root / 'public' / 'engine'
meta = json.loads((dest / 'PROVENANCE.json').read_text())
base = meta.get('artifactBaseUrl') or meta['repository'] + '/releases/download/' + meta['release'] + '/'

def download(name):
    print('Downloading', name)
    request = Request(base + name, headers={'User-Agent': 'Pocket-Slicer-source-build'})
    with urlopen(request, timeout=120) as response:
        return response.read()

artifacts = {'slicer-mt.js': download('slicer-mt.js')}
parts = meta['wasmStorage']['parts']
artifacts['slicer-mt.wasm'] = (b''.join(download(name) for name in parts)
                             if meta.get('artifactBaseUrl') else download('slicer-mt.wasm'))
for name, data in artifacts.items():
    if hashlib.sha256(data).hexdigest() != meta['sha256'][name]:
        raise SystemExit(f'Checksum mismatch for {name}; no replacement written.')
if len(artifacts['slicer-mt.wasm']) != meta['wasmStorage']['totalBytes']:
    raise SystemExit('WASM length mismatch; no replacement written.')

with TemporaryDirectory(prefix='.engine-restore-', dir=dest) as temporary:
    staging = Path(temporary)
    (staging / 'slicer-mt.js').write_bytes(artifacts['slicer-mt.js'])
    split = meta['wasmStorage']['splitAtBytes']
    for index, name in enumerate(parts):
        (staging / name).write_bytes(artifacts['slicer-mt.wasm'][index*split:(index+1)*split])
    for name in ['slicer-mt.js', *parts]:
        (staging / name).replace(dest / name)
print('Pinned engine restored and verified.')
