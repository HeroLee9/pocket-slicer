# Pocket Slicer

A local iPhone slicer that runs the real OrcaSlicer engine on the device. Built for a Creality K1C, with G-code export to Files or a connected USB drive. No model is uploaded for slicing.

The installed iPhone version under [`ios/`](ios/README.md) bundles all application and engine files so it does not depend on a hosted website. Its native simulator test has passed actual Orca slicing, and a device package has been built. Physical iPhone testing is still required. The same React interface runs on the hosted Site, with slicing performed locally in the browser. The existing native preview release predates the newest plate tools and expert-settings changes.

## Use on iPhone

Open the Pocket Slicer Site in Safari. Import models, edit the plate and settings, slice, then use **Save G-code → Save to Files** to choose your USB drive. The computer is not required. **Settings & help → Save app for offline** caches the app and engine; refresh this copy after an update. Safari can evict website storage.

For the separate native preview release:

Follow the [free installation guide](ios/INSTALL.md) to sign and install the unsigned IPA using SideStore. A Mac or Xcode is not required on the user's computer. Free signing needs renewal every seven days; the PC is needed for initial setup and sometimes recovery.

Open **Pocket Slicer** from the Home Screen. Tap **Import model** or **Try a 20 mm cube**. Choose the nozzle, filament and print settings, then **Slice model**. Keep the app open while slicing. Inspect the preview, tap **Save G-code**, and select your USB drive in the native Files picker. The PC and internet can be off while slicing and exporting.

The Files picker allows all files so iOS does not disable STL files whose type it does not recognize. The app checks for STL, OBJ or 3MF after selection; choosing another format displays an error.

The installed app already includes its complete engine; no offline download or website shortcut is needed. Settings and the printer address are saved on the phone. The printer API key stays in the current session.

Printer upload is optional and has not been verified from the native iPhone app. Enter a reachable Moonraker URL in Settings and test the connection. Upload sends the file without starting a print. Local-network permission, transport rules, Moonraker authentication and CORS may affect direct uploads. The USB workflow is independent of the printer network.

## Supported scope

- STL, OBJ and 3MF geometry; up to 20 model instances on one plate, one filament.
- Select, drag or numerically position, rotate, flip, mirror, uniform/axis scale, duplicate, delete, undo/redo, auto arrange, lay on a selected face, and worker-based automatic orientation.
- K1C 0.4, 0.6 and 0.8 mm profiles; PLA, PETG, Elegoo Rapid PETG and ABS.
- Quick settings and a searchable editor generated from the pinned Orca 2.4.2 option definitions, with typed validation, inherited defaults, per-option reset, local persistence, and JSON override import/export. Unsupported desktop/project/hardware features are explicitly marked unavailable.
- Defaults: gyroid, three walls with inner/outer/inner order, 5,000 mm/s² print/travel acceleration with lower first-layer/role values retained, and the installed Creality Helper Script KAMP adaptive mesh/purge macros.
- Actual Orca estimates and extrusion toolpaths with a layer slider.
- Native Files export to a USB drive, bundled offline engine and optional Moonraker upload.

3MF print settings, painted supports, colors, modifier volumes and multi-plate layouts are not imported. All meshes in each imported file are combined. Separate imported models can be positioned independently, then are merged into one same-material engine object for slicing. Per-object settings and sequential printing are unavailable. The app limits each import to 50 MB and the complete plate to one million triangles; the preview shows at most 750,000 extrusion segments, while exported G-code remains complete. These limits do not guarantee a device can slice every accepted model. This version does not preserve unsaved models or G-code after a page reload.

Auto orientation compares sampled contact, overhang, support height and model height; it is a heuristic and does not guarantee the best surface finish or strength.

Elegoo Rapid PETG starts at 250°C nozzle / 80°C supported build plates, 18 mm³/s maximum flow and 0.99 flow ratio. It derives from Orca’s Elegoo profile with K1C-specific adjustments, and has not been calibrated on the user’s spool.

KAMP mode enables `_ADAPTIVE_BED_MESH_ON` and `_ADAPTIVE_PURGE_LINE_ON`, emits object boundary polygons, and calls `START_PRINT` once. The installed Guilouz Creality Helper Script macros perform homing, meshing and purging; the slicer does not append a second mesh or purge. Standard startup remains selectable.

The selected nozzle must match your hardware. K1C profiles retain `START_PRINT` and `END_PRINT`; a rooted printer must retain compatible macros. The inherited ABS bed temperature is capped at the K1C's published 100°C maximum. The engine checks explicit G-code motion bounds, but cannot inspect motion inside printer-side macros.

## Develop and build

Node 24 or later is recommended.

```sh
npm ci
npm run dev
npm test
npm run test:engine
node scripts/test-orca-settings.mjs
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

## Optional browser build

The browser development build can also be served as a standalone static application. This is separate from native installation; the iPhone app does not use a public host. For a static project path named `pocket-slicer`, build with:

```sh
python3 scripts/package-source.py
BASE_PATH=/pocket-slicer/ npm run build
```

Serve the contents of `dist/`. Service workers, engine files, icons, source downloads and offline storage all use the configured base path. For a domain's root path, use plain `npm run build`. In the browser, **Settings & help → Save app for offline** stores the engine; browser storage may later be evicted. This repository's native workflow does not deploy a website.

## Source and license

Pocket Slicer is distributed under AGPL-3.0; see `LICENSE`. The source download contains this app's source, lockfile, build scripts and notices. Engine binaries are obtained with `scripts/fetch-engine.py`. OrcaWasm and its dependencies retain their own licenses. See `public/engine/NOTICE.md`, `public/engine/PROVENANCE.json`, and `public/licenses/`.

- OrcaWasm source: https://github.com/Hiosdra/OrcaWasm
- OrcaSlicer 2.4.2 source: https://github.com/OrcaSlicer/OrcaSlicer/tree/v2.4.2

The app is independent of the upstream OrcaSlicer project. No official iOS release or endorsement is implied.
