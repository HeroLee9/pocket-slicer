# Pocket Slicer

A browser app that runs the real OrcaSlicer engine locally on your device. Built for a Creality K1C and iPhone, with G-code export to Files or a connected USB drive. No model is uploaded for slicing.

## Use on iPhone

Open the app's HTTPS address in Safari. The first visit may reload once while the app prepares local slicing. Tap **Import model** or **Try a 20 mm cube**. Choose the nozzle, filament and print settings, then **Slice model**. Keep Safari open while slicing. Inspect the preview, tap **Save G-code**, and choose **Save to Files**. Select your USB drive under Locations. If the browser downloads instead, move the `.gcode` file to the drive in Files.

The Files picker allows all files so iOS does not disable STL files whose type it does not recognize. The app checks for STL, OBJ or 3MF after selection; choosing another format displays an error.

**Settings & help → Save app for offline** saves the complete application and engine. Once that reports success, test a reload and slice in airplane mode. Safari can evict website storage when space is low. Add the app to your Home Screen from Safari's Share menu.

Printer upload is optional. Enter a reachable Moonraker URL in Settings and test the connection. Upload sends the file without starting a print. Browser local-network permission, mixed-content rules, Moonraker authentication and CORS may affect direct uploads. The USB workflow is independent of the printer network.

## Supported scope

- STL, OBJ and 3MF geometry; one combined model, one filament.
- Scale and rotate, automatic bed centering and grounding.
- K1C 0.4, 0.6 and 0.8 mm profiles; PLA, PETG and ABS.
- Layer height, infill, walls, automatic normal/tree supports, brim and temperatures.
- Actual Orca estimates and extrusion toolpaths with a layer slider.
- Native file sharing/download, offline engine storage and optional Moonraker upload.

3MF print settings, painted supports, colors, modifier volumes and multi-plate layouts are not imported. All meshes in an imported file are combined. The app limits imports to 50 MB and one million triangles; the preview shows at most 750,000 extrusion segments, while exported G-code remains complete. These limits do not guarantee a device can slice every accepted model. This version does not preserve unsaved models or G-code after a page reload.

The selected nozzle must match your hardware. K1C profiles retain `START_PRINT` and `END_PRINT`; a rooted printer must retain compatible macros. The inherited ABS bed temperature is capped at the K1C's published 100°C maximum. The engine checks explicit G-code motion bounds, but cannot inspect motion inside printer-side macros.

## Develop and build

Node 24 or later is recommended.

```sh
npm ci
npm run dev
npm test
npm run test:engine
npm run build
npm run preview
```

The checked-in WebAssembly binary is the exact pinned upstream release split into two parts for static hosting size limits. `public/engine/PROVENANCE.json` identifies the release, source and checksums. The browser worker reassembles it; there is no remote slicing service.

Deploy `dist/` over HTTPS with these response headers (included in `public/_headers`):

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

`http://localhost` works for development. A plain HTTP LAN address on an iPhone does not provide the secure context required by the threaded engine. If a host strips the headers, the app's service worker adds them to its own static responses and reloads once before model import. Authentication pages and callbacks are excluded. `npm run build` generates an offline asset manifest with hashes. Source downloads are packaged by `scripts/package-source.py`.

## Host without Sites

The app is a standalone static application and does not need Sites, a slicing server, or an always-on personal computer. Any HTTPS static host can serve the built files. For a GitHub Pages project named `pocket-slicer`, build with:

```sh
python3 scripts/package-source.py
BASE_PATH=/pocket-slicer/ npm run build
```

Publish the contents of `dist/` (including `.nojekyll`) as the Pages publishing branch. Service workers, engine files, icons, source downloads and offline storage all use the configured base path. For a domain's root path, use plain `npm run build`. GitHub Pages uses the app's service-worker isolation fallback because it does not read `_headers`.

## Source and license

Pocket Slicer is distributed under AGPL-3.0; see `LICENSE`. The source download contains this app's source, lockfile, build scripts and notices. Engine binaries are obtained with `scripts/fetch-engine.py`. OrcaWasm and its dependencies retain their own licenses. See `public/engine/NOTICE.md`, `public/engine/PROVENANCE.json`, and `public/licenses/`.

- OrcaWasm source: https://github.com/Hiosdra/OrcaWasm
- OrcaSlicer 2.4.2 source: https://github.com/OrcaSlicer/OrcaSlicer/tree/v2.4.2

The app is independent of the upstream OrcaSlicer project. No official iOS release or endorsement is implied.
