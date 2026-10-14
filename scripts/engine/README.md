# Rebuilding Pocket Slicer's mobile engine

This folder contains the complete local modification and a Linux build recipe for
the customized OrcaWasm engine. It does not modify print settings. It removes
Orca's retained desktop preview vertices and acceleration visualization vertices,
which the browser bridge does not use. The timing planner, G-code writer, filament
accounting, and postprocessing remain enabled.

The native bounds checker remains enabled. A small map of XY extrema and maximum
print Z per object/filament replaces its full point history. Both extrusion
endpoints are included. One latest vertex remains for seam bookkeeping, and each
bounded planner block records the original timing-cache classification, including
seam markers. The app also validates the finished G-code, including arc extrema,
before allowing export.

## Pinned corresponding source

| Component | Source revision |
| --- | --- |
| [OrcaWasm](https://github.com/Hiosdra/OrcaWasm) | `60a09e04f1990be39c8f6f35dffef1a2c9e224c4` |
| [OrcaSlicer](https://github.com/OrcaSlicer/OrcaSlicer) | `8500fcdccaa10b5099ac20d252af3a7c560046f1` (v2.4.2) |
| [Emsdk](https://github.com/emscripten-core/emsdk) | `8f685c26ee9f672081e61e22c6aa60fa972d00a9`, toolchain `3.1.74` |

The upstream OrcaWasm repository contains its bridge, compatibility patches, CMake
configuration, and dependency recipe. Its nested `orca/` directory must contain
the **full OrcaSlicer source** at the pinned revision. The build script fetches
these exact commits if absent; it also accepts extracted corresponding source
already placed at `BUILD_DIRECTORY/orcawasm/` and
`BUILD_DIRECTORY/orcawasm/orca/`. Verify the source archive's published checksum
before using an extracted archive. Keep the upstream license and notice files
with redistributed source and binaries.

## Build

Use Linux x86-64 with Bash, Python 3, Git, curl, tar, make, a native Clang toolchain,
CMake, Ninja, ccache, and Node.js on `PATH`. The build environment uses
CMake 3.31.10, Ninja 1.13.0, ccache 4.14.1, and Emscripten 3.1.74. The script installs
Emsdk into the supplied build directory; it does not install system packages or
change home-directory configuration. CMake/Ninja can also be installed into a
local Python environment with `pip install cmake==3.31.10 ninja==1.13.0`.

Choose a new build directory using only letters, numbers, `/`, `_`, `.`, and `-`
(the pinned upstream dependency recipe has unquoted paths). Allow substantial disk, RAM,
and build time. The upstream recipe builds the complete dependencies, including
OpenCASCADE. It uses 8 parallel dependency jobs and 4 main compilation jobs;
override with `POCKET_DEPENDENCY_JOBS` and `POCKET_MAIN_JOBS` when necessary.

```sh
bash scripts/engine/build.sh /path/to/pocket-engine-build all
```

For separate stages, use `prepare`, `deps`, then `main` instead of `all`.
`prepare` obtains the pinned source and generates the local scripts without
installing Emsdk or compiling. Dependency stamps allow completed dependency builds
to be reused. The main stage applies `apply_headless.py` after the upstream patches
and compiles with **`-DORCA_WASM_HEADLESS_GCODE=1` in global C++ flags**. This must
apply to every main Orca C++ translation unit because it changes shared class
definitions. Never add it to only one target.

Outputs are `BUILD_DIRECTORY/orcawasm/artifacts/slicer-mt.js` and
`slicer-mt.wasm`, also copied to `wasm-artifacts/`. The recipe runs the upstream
engine smoke test. It preserves threading, native WebAssembly exception handling,
arc fitting, and all print settings. It does not publish or install these files
into the application automatically.

The adapter validates the exact upstream recipe hash before changing paths. The
headless patch validates original and resulting source hashes, refuses unknown
sources, writes only after all inputs are verified, and is safe to rerun. Without
the compile definition, the original source paths are unchanged.

## Validation before distribution

```sh
python3 scripts/engine/verify_patch.py /path/to/pocket-engine-build/orcawasm/orca
```

This source-level check requires the pinned Git checkout. It verifies repeat
application, rejection of modified input, the unchanged non-headless source, and
key memory, timing, seam, and validation invariants. Real validation must also
compare the original and rebuilt engine with identical inputs and settings:
generated G-code (normalizing only its generation timestamp), timing and filament
statistics, output bounds, repeat slicing, and peak memory under a bounded WASM
memory budget. The app's test models and a representative larger model should
both be included. Source checks alone do not establish output equivalence.
