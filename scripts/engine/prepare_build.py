#!/usr/bin/env python3
"""Adapt the pinned OrcaWasm Linux recipe to a caller-selected build directory."""
from pathlib import Path
import argparse
import hashlib
import re
import shlex

UPSTREAM_RECIPE_SHA256 = 'e71539b3dac1651dd5bea19431ec56b953c65de45b0c9595668306cc62f5fe99'


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError(f'Expected one pinned recipe anchor: {old[:90]!r}')
    return text.replace(old, new, 1)


def prepare(base, patch_dir, dependency_jobs=8, main_jobs=4):
    base = base.resolve()
    patch_dir = patch_dir.resolve()
    # Some pinned dependency commands do not quote their temporary paths.
    if not re.fullmatch(r'[A-Za-z0-9_./-]+', str(base)):
        raise ValueError('Use a build directory with only letters, numbers, /, _, ., and -.')
    if min(dependency_jobs, main_jobs) < 1:
        raise ValueError('Parallel build job counts must be positive.')
    source = base / 'orcawasm/scripts/build-local-wsl.sh'
    original = source.read_bytes()
    if hashlib.sha256(original).hexdigest() != UPSTREAM_RECIPE_SHA256:
        raise RuntimeError('Unrecognized upstream build recipe; refusing to adapt it.')
    script = original.decode()
    base_value = shlex.quote(str(base))
    script = replace_once(script, 'set -e\n', f'''set -euo pipefail
export POCKET_BUILD_ROOT={base_value}
export POCKET_HOST_PATH="${{POCKET_HOST_PATH:-$PATH}}"
export TMPDIR="$POCKET_BUILD_ROOT/tmp"
mkdir -p "$TMPDIR"
''')
    script = replace_once(script, '${EMSDK:-/opt/emsdk}', '${EMSDK:-$POCKET_BUILD_ROOT/emsdk}')
    script = script.replace('source "$EMSDK/emsdk_env.sh"', '''source "$EMSDK/emsdk_env.sh"
export PATH="$POCKET_BUILD_ROOT/bin:$POCKET_BUILD_ROOT/tools/bin:$POCKET_HOST_PATH:$PATH"''')
    script = replace_once(script, 'export CCACHE_DIR="$HOME/.cache/ccache"',
                          'export CCACHE_DIR="$POCKET_BUILD_ROOT/ccache"')
    script = replace_once(script, '~/user-config.jam', '"$POCKET_BUILD_ROOT/boost-user-config.jam"')
    script = replace_once(script, './b2 \\\n', './b2 --user-config="$POCKET_BUILD_ROOT/boost-user-config.jam" \\\n')
    script = script.replace('/tmp/', str(base / 'tmp') + '/')
    script = script.replace('-j"$(nproc)"', f'-j{dependency_jobs}')
    script = replace_once(script, 'emmake cmake --build build-wasm --target slicer -j4',
                          f'emmake cmake --build build-wasm --target slicer -j{main_jobs}')
    # Source checkout is explicit and pinned in build.sh. This also permits using
    # complete corresponding-source archives without Git metadata.
    start = script.index('if [ -d orca/.git ]; then\n')
    stop = script.index('\nfi\n', start) + len('\nfi\n')
    script = script[:start] + '''test -f orca/src/libslic3r/GCode/GCodeProcessor.cpp || {
  echo 'Missing pinned Orca source. Run scripts/engine/build.sh first.' >&2
  exit 1
}
''' + script[stop:]
    configure = script.index('# Configure WASM build\n')
    header = script[:script.index('# ═')]
    dependency = script[:configure] + 'exit 0\n'
    main = header + f'python3 {shlex.quote(str(patch_dir / "apply_headless.py"))} "$POCKET_BUILD_ROOT/orcawasm/orca"\n' + script[configure:]
    main = replace_once(main, '-DSLIC3R_NO_OPENCV=1 ${EXTRA_CXX_FLAGS}',
                        '-DSLIC3R_NO_OPENCV=1 -DORCA_WASM_HEADLESS_GCODE=1 ${EXTRA_CXX_FLAGS}')
    main = replace_once(main, '  -DCMAKE_BUILD_TYPE=Release \\\n',
                        '  -DCMAKE_BUILD_TYPE=Release \\\n  -DCMAKE_EXPORT_COMPILE_COMMANDS=ON \\\n')
    for name, content in [('build-pocket-deps.sh', dependency), ('build-pocket-main.sh', main)]:
        target = source.parent / name
        target.write_text(content)
        target.chmod(0o755)
        print(target)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('build_directory', type=Path)
    parser.add_argument('--dependency-jobs', type=int, default=8)
    parser.add_argument('--main-jobs', type=int, default=4)
    args = parser.parse_args()
    prepare(args.build_directory, Path(__file__).resolve().parent,
            args.dependency_jobs, args.main_jobs)
