#!/usr/bin/env python3
"""Package pinned upstream engine source plus Pocket Slicer's custom build recipe."""
from pathlib import Path, PurePosixPath
import argparse
import copy
import hashlib
import io
import os
import re
import subprocess
import tempfile
import zipfile

ORCAWASM_COMMIT = '60a09e04f1990be39c8f6f35dffef1a2c9e224c4'
ORCA_COMMIT = '8500fcdccaa10b5099ac20d252af3a7c560046f1'
UPSTREAM_PREFIX = 'OrcaWasm-60a09e04/'
CUSTOM_PREFIX = 'PocketSlicer-custom-source/'
CUSTOM_FILES = ('README.md', 'apply_headless.py', 'build.sh', 'prepare_build.py', 'verify_patch.py')
ARCHIVE_DATE = (2026, 10, 13, 0, 0, 0)
APP_ROOT = Path(__file__).resolve().parent.parent
SOURCE_URL = f'https://github.com/Hiosdra/OrcaWasm/tree/{ORCAWASM_COMMIT}'
ORCA_URL = f'https://github.com/OrcaSlicer/OrcaSlicer/tree/{ORCA_COMMIT}'
ORCA_ARCHIVE_URL = f'https://github.com/OrcaSlicer/OrcaSlicer/archive/{ORCA_COMMIT}.zip'


def source_guide():
    return f'''# Corresponding source for Pocket Slicer's customized engine

This package contains the unchanged tracked OrcaWasm source at
`{ORCAWASM_COMMIT}` in `{UPSTREAM_PREFIX}`, and the complete Pocket Slicer
headless-memory patch plus portable build recipe in `{CUSTOM_PREFIX}scripts/engine/`.
All original upstream files, including LICENSE, NOTICE, workflows, patches,
bridge, API glue, tests, dependency versions, and build metadata, are retained.

The full OrcaSlicer source is a separate, much larger download. Obtain this exact
revision, not an arbitrary newer branch:

- Full OrcaSlicer source archive: {ORCA_ARCHIVE_URL}
- OrcaSlicer source tree: {ORCA_URL}
- OrcaWasm source tree: {SOURCE_URL}

To rebuild on Linux, copy `{UPSTREAM_PREFIX}` to a new build directory as its
`orcawasm/` subdirectory, then run:

```sh
bash {CUSTOM_PREFIX}scripts/engine/build.sh /path/to/build-directory all
```

The build script fetches the exact OrcaSlicer commit if the nested `orca/` source
is absent. Alternatively extract the full Orca archive into that nested folder.
It obtains pinned Emsdk and installs Emscripten 3.1.74, applies the original
upstream compatibility patches followed by `apply_headless.py`, fetches/builds
the dependency sources specified by the original recipe, and compiles the engine.
Use a build directory containing only letters, digits, `/`, `_`, `.`, and `-`.

Read `{CUSTOM_PREFIX}scripts/engine/README.md` for prerequisites, exact source
and toolchain revisions, separate build stages, outputs, and validation steps.
The macro `ORCA_WASM_HEADLESS_GCODE=1` must be applied globally to every main Orca
C++ translation unit. The customized engine omits retained desktop toolpath
visualization data while preserving the print pipeline and native bounds checks;
the patch does not change user print settings or emitted print commands by design.
Execution tests are required to confirm output equivalence for a rebuilt binary.

Original upstream instructions are retained at `{UPSTREAM_PREFIX}README.md`,
`scripts/build-local-wsl.sh`, and `.github/workflows/build-wasm.yml` inside that
folder. Those original scripts alone do not apply Pocket Slicer's custom patch.
The browser worker adapter and application source are distributed separately in
`pocket-slicer-source.zip`. Exact binary hashes are in `engine/PROVENANCE.json`
beside the application. Preserve the upstream licenses and notices when
redistributing source or binaries.
'''


def check_public_text(relative, content):
    """Fail closed on accidental local paths or recognizable credential values."""
    text = content.decode('utf-8')
    forbidden = (
        r'/(?:home|Users)/[^\s/]+/',
        r'/tmp/codex-remote-attachments/',
        r'\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}',
        r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
        r'(?i)authorization\s*[:=]\s*[\"\x27]?bearer\s+[A-Za-z0-9._~-]{16,}',
    )
    if any(re.search(pattern, text) for pattern in forbidden):
        raise ValueError(f'Potential private path or credential in custom source: {relative}')


def new_info(name, executable=False):
    info = zipfile.ZipInfo(name, ARCHIVE_DATE)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = (0o100755 if executable else 0o100644) << 16
    return info


def package(checkout, destination, update_notice=False):
    revision = subprocess.check_output(
        ['git', '-C', str(checkout), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != ORCAWASM_COMMIT:
        raise ValueError(f'Expected OrcaWasm HEAD {ORCAWASM_COMMIT}, got {revision}')
    # git archive deliberately excludes local modifications, untracked files,
    # Git metadata, credentials, downloaded dependencies, and nested repositories.
    upstream_bytes = subprocess.check_output([
        'git', '-C', str(checkout), 'archive', '--format=zip',
        f'--prefix={UPSTREAM_PREFIX}', ORCAWASM_COMMIT,
    ])
    custom = []
    for name in CUSTOM_FILES:
        path = APP_ROOT / 'scripts/engine' / name
        content = path.read_bytes()
        check_public_text(name, content)
        custom.append((f'{CUSTOM_PREFIX}scripts/engine/{name}', content))
    guide = source_guide().encode()
    check_public_text('CORRESPONDING-SOURCE.md', guide)
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.engine-source-', suffix='.zip', dir=destination.parent)
    os.close(descriptor)
    temporary = Path(temporary)
    try:
        with zipfile.ZipFile(io.BytesIO(upstream_bytes)) as original, zipfile.ZipFile(
                temporary, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as output:
            for entry in original.infolist():
                name = PurePosixPath(entry.filename)
                if name.is_absolute() or '..' in name.parts or not entry.filename.startswith(UPSTREAM_PREFIX):
                    raise ValueError('Unexpected path in pinned Git archive')
                if entry.filename.startswith(UPSTREAM_PREFIX + 'orca/') and not entry.is_dir():
                    raise ValueError('Unexpected full nested Orca source in upstream archive')
                info = copy.copy(entry)
                info.compress_type = zipfile.ZIP_DEFLATED
                output.writestr(info, original.read(entry))
            output.writestr(new_info('CORRESPONDING-SOURCE.md'), guide)
            for name, content in custom:
                output.writestr(new_info(name, name.endswith(('.sh', '.py'))), content)
        # Check every original file byte for byte, including licenses/workflows.
        with zipfile.ZipFile(io.BytesIO(upstream_bytes)) as original, zipfile.ZipFile(temporary) as output:
            assert output.testzip() is None
            for entry in original.infolist():
                assert output.read(entry.filename) == original.read(entry)
            assert len(output.infolist()) == len(original.infolist()) + len(custom) + 1
        digest = hashlib.sha256(temporary.read_bytes()).hexdigest()
        temporary.replace(destination)
        if update_notice:
            notice = f'''Pocket Slicer customized engine source and build information

Source archive: ./{destination.name}
SHA-256: {digest}

The archive contains all tracked original OrcaWasm source/build metadata and the
Pocket Slicer headless-memory patch plus portable build recipe. The original
upstream files are unchanged. The custom source is in PocketSlicer-custom-source/.
Start with CORRESPONDING-SOURCE.md inside the archive.

Pinned OrcaWasm source:
{SOURCE_URL}

Full pinned OrcaSlicer source (separate download):
{ORCA_ARCHIVE_URL}
Source tree:
{ORCA_URL}

Build instructions: PocketSlicer-custom-source/scripts/engine/README.md
Build command: bash scripts/engine/build.sh /path/to/build-directory all
Run that command from the extracted PocketSlicer-custom-source folder. It fetches
the exact upstream source when absent, installs Emscripten 3.1.74 locally, and
builds dependencies and the modified engine. The compiler definition
ORCA_WASM_HEADLESS_GCODE=1 is applied across all main C++ translation units.

The customized source removes retained native desktop visualization data while
keeping the print pipeline, timing planner, filament accounting, and native
bounds checks. The app's worker adapter is in pocket-slicer-source.zip. The source
package contains no user models, generated G-code, or local build directories.

Original license and notices remain in the source archive. Runtime artifact
hashes and build provenance are in ../engine/PROVENANCE.json. This source package
does not itself assert that any particular binary has passed equivalence tests.
'''
            check_public_text('ENGINE-SOURCE.txt', notice.encode())
            destination.with_name('ENGINE-SOURCE.txt').write_text(notice)
        return digest
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_checkout', type=Path, help='OrcaWasm Git checkout at the pinned HEAD')
    parser.add_argument('--output', type=Path, default=APP_ROOT / 'public/source/orcawasm-source.zip')
    parser.add_argument('--update-notice', action='store_true', help='Also regenerate adjacent ENGINE-SOURCE.txt with the final archive hash')
    args = parser.parse_args()
    archive_hash = package(args.source_checkout, args.output, args.update_notice)
    print(f'Engine source archive: {args.output.stat().st_size:,} bytes; SHA-256 {archive_hash}')
