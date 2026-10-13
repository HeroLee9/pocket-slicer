#!/usr/bin/env python3
"""Create reproducible app source download, excluding build output and binaries."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
destination = root / 'public/source/pocket-slicer-source.zip'
destination.parent.mkdir(parents=True, exist_ok=True)
excluded_dirs = {'node_modules', '.git', '.openai', 'dist', 'test-results', 'playwright-report', 'source'}
files = []
for path in sorted(root.rglob('*')):
    if not path.is_file():
        continue
    relative = path.relative_to(root)
    if relative.parts[:2] in {('ios', 'web'), ('ios', 'build')} or any(part.endswith(('.xcodeproj', '.xcworkspace', '.xcresult')) for part in relative.parts):
        continue
    if any(part in excluded_dirs for part in relative.parts):
        continue
    if path.name.endswith(('.tsbuildinfo', '.wasm', '.wasm.part0', '.wasm.part1')):
        continue
    files.append((path, relative))
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path, relative in files:
        info = zipfile.ZipInfo('pocket-slicer/' + relative.as_posix(), date_time=(2026,10,13,0,0,0))
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, path.read_bytes())
print(f'Source archive: {len(files)} files, {destination.stat().st_size:,} bytes')
