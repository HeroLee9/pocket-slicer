#!/usr/bin/env bash
# Build the customized OrcaWasm engine on Linux without changing system packages.
set -euo pipefail
if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 BUILD_DIRECTORY [all|prepare|deps|main]" >&2
  exit 2
fi
POCKET_MODE="${2:-all}"
case "$POCKET_MODE" in all|prepare|deps|main) ;; *) echo 'Unknown build mode.' >&2; exit 2;; esac
POCKET_RECIPE_DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$1"
POCKET_BUILD_DIR="$(cd "$1" && pwd)"
if [[ ! "$POCKET_BUILD_DIR" =~ ^[A-Za-z0-9_./-]+$ ]]; then
  echo 'Choose a build directory using only letters, numbers, /, _, ., and -.' >&2
  exit 2
fi
export POCKET_HOST_PATH="$PATH"

checkout_pinned() {
  local repository="$1" revision="$2" target="$3"
  if [[ ! -e "$target" || ( -d "$target" && -z "$(ls -A "$target")" ) ]]; then
    git init -q "$target"
    git -C "$target" remote add origin "$repository"
    git -C "$target" fetch --depth 1 origin "$revision"
    git -C "$target" checkout --detach FETCH_HEAD
  elif [[ -e "$target/.git" ]]; then
    [[ "$(git -C "$target" rev-parse HEAD)" == "$revision" ]] || {
      echo "Unexpected source revision in $target; use a new build directory." >&2
      exit 1
    }
  else
    echo "Using extracted corresponding source at $target"
  fi
}

checkout_pinned https://github.com/Hiosdra/OrcaWasm.git \
  60a09e04f1990be39c8f6f35dffef1a2c9e224c4 "$POCKET_BUILD_DIR/orcawasm"
checkout_pinned https://github.com/OrcaSlicer/OrcaSlicer.git \
  8500fcdccaa10b5099ac20d252af3a7c560046f1 "$POCKET_BUILD_DIR/orcawasm/orca"

python3 "$POCKET_RECIPE_DIR/prepare_build.py" "$POCKET_BUILD_DIR" \
  --dependency-jobs "${POCKET_DEPENDENCY_JOBS:-8}" --main-jobs "${POCKET_MAIN_JOBS:-4}"
[[ "$POCKET_MODE" == prepare ]] && exit 0

for executable in git curl tar make clang cmake ninja ccache node python3; do
  command -v "$executable" >/dev/null || { echo "Missing prerequisite: $executable" >&2; exit 1; }
done
export EMSDK="${EMSDK:-$POCKET_BUILD_DIR/emsdk}"
if [[ ! -f "$EMSDK/emsdk_env.sh" ]]; then
  checkout_pinned https://github.com/emscripten-core/emsdk.git \
    8f685c26ee9f672081e61e22c6aa60fa972d00a9 "$EMSDK"
fi
"$EMSDK/emsdk" install 3.1.74
"$EMSDK/emsdk" activate 3.1.74

if [[ "$POCKET_MODE" == all || "$POCKET_MODE" == deps ]]; then
  bash "$POCKET_BUILD_DIR/orcawasm/scripts/build-pocket-deps.sh"
fi
if [[ "$POCKET_MODE" == all || "$POCKET_MODE" == main ]]; then
  bash "$POCKET_BUILD_DIR/orcawasm/scripts/build-pocket-main.sh"
fi
