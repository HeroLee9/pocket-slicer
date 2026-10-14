# Validation — October 13, 2026

This app uses the actual pinned OrcaWasm engine in a worker. The native iOS simulator and Linux browser checks below are separate from physical iPhone and printer testing, which remains pending.

## Plate tools and expert settings update

The current Sites source adds multiple model instances, plate manipulation, expert settings and Elegoo Rapid PETG. The previously released native IPA has not been rebuilt for this update.

- 56 shared tests passed, including mirrored winding, immutable source meshes, absolute plate coordinates, bed/brim bounds, arrangement, diagonal face orientation without unnecessary cube yaw, typed parameter validation and reviewed profile imports.
- All 474 editable options from the pinned Orca 2.4.2 catalog were accepted by the actual WASM strict profile parser. The other 203 catalog entries explain unsupported hardware, desktop or project capabilities. Three real-engine scenarios verified changed layer heights, walls, infill, cooling, retraction, speeds, acceleration, custom/empty G-code, ironing and fuzzy skin in output. Run `node scripts/test-orca-settings.mjs`.
- Mobile WebKit at 393 × 852 and Chromium at 1440 × 1050 passed XYZ positioning, drop to bed, uniform/axis scaling, flips, mirrors, auto orientation, real canvas face selection and dragging, duplication, arrangement, deletion and undo/redo. Both exported the same 652,599-byte, 40-layer two-model plate with 9,619 extrusion moves. There were no page errors or external HTTP requests; Chromium emitted only software GPU performance notices.
- Mobile WebKit passed a complete expert-settings flow: default migration, Elegoo selection, search, numeric/enum/G-code edits, invalid temperature and layer checks, reviewed import with excluded-key disclosure, override/full-profile downloads, local persistence and actual slicing. Export contained 417,443 bytes and 80 layers with the requested overrides. Removing row content-visibility prevented row-height changes from shifting the Slice button during mobile scrolling.
- Elegoo Rapid PETG sliced on 0.4, 0.6 and 0.8 mm profiles with 250°C nozzle and 80°C bed. The profile has not been physically calibrated on the user's spool.
- KAMP tests found object polygons before exactly one START_PRINT and both adaptive selectors. A separated, transformed and mirrored two-part test retained exact XY bounds of 35–180 and 45–140 mm; extrusion remained on both separate islands. Requested defaults produced gyroid, inner/outer/inner, and no M204 command above 5000 mm/s².

The packaged offline build cached all 22 assets, then reloaded, auto-oriented, sliced and exported after its server was physically stopped. This verifies offline delivery of the new orientation worker as well as the slicing engine.

Browser plugin was not available; local Playwright used the installed WebKit/Chromium runtimes. Screenshots and JSON evidence remain outside the source repository in the task workspace. Physical iPhone/USB and printer-side KAMP behavior remain untested; no printer command or print job was sent.

## Native iOS

[GitHub Actions run 38476026700](https://github.com/HeroLee9/pocket-slicer/actions/runs/38476026700), source commit `7b66aa9511c4475a4696c172bdb364083d2414f7`, passed with Xcode 26.6 on the selected iPhone 17 Pro simulator. The actual `WKWebView` test confirmed a secure loopback context, cross-origin isolation, SharedArrayBuffer and shared WebAssembly memory using public APIs. Orca 2.4.2/API 0.7.0 sliced the cube into 100 layers, 252,604 bytes and 4,909 G0/G1 lines containing extrusion values. START_PRINT, END_PRINT, M83 and progress callbacks were verified.

The release build produced an unsigned `iphoneos` ARM64 IPA with iOS 17 minimum deployment target. Package inspection confirmed that the engine bytes match the pinned source assets and that test probe assets and signing material are absent. It does not depend on a public website. This is simulator/build validation; physical device memory limits, Files import/export and printer behavior are not established by these results.

[Run 38477145239](https://github.com/HeroLee9/pocket-slicer/actions/runs/38477145239), source commit `424133fd4960b3298fc63e1abb6fde63bbf777c4`, passed all seven native tests: actual Orca slicing, exact WASM delivery and headers, HTTP path/Host/method restrictions, 21 export payload cases through the real WK reply bridge, wrong-origin rejection, preference persistence and rejection of secret/invalid preferences. Export bridge tests stop before presenting Files; they do not establish that a physical USB drive can receive a file.

## Browser and shared code

- 34 unit tests passed for settings, profiles, G-code preview parsing, printable bounds and file delivery, including native bridge byte integrity, waiting for export confirmation, cancellation/error handling and the 64 MB payload limit. STL checks cover complete binary/ASCII files, ambiguous binary headers, partial records, short headers and excessive declared triangle counts. Truncated binary models are rejected before parser allocation; missing geometry is never silently dropped or fabricated.
- Eight actual engine configurations passed: PLA, PETG, ABS, 0.6 mm and 0.8 mm nozzles, 100% infill, normal supports and tree supports. Generated motion, temperatures, extrusion and K1C start/end macros were checked.
- The default 20 mm cube produced 252,604 bytes of G-code, 100 layers and 6,219 extrusion moves. Orca estimated 3.73 g and 17 minutes 29 seconds.
- Chromium and WebKit passed model import, real slicing, layer preview and G-code download. Mobile and desktop layouts were inspected. Cancellation, invalid input, retry, empty numeric fields and invalidation of stale output were exercised.
- Offline storage was completed, the local server was stopped, and the app reloaded, sliced and exported successfully without a network connection. Redirected authentication pages and mismatched asset hashes were rejected during offline preparation.
- The production build was also served without isolation headers. Chromium and WebKit each reloaded exactly once, gained cross-origin isolation and sliced/exported the cube with no console errors. Servers that supplied the headers needed no setup reload. Authentication routes, redirects and inline sign-in pages remained unchanged.

The original iPhone test exposed an overly restrictive file picker: iOS disabled STL files. The picker now allows file selection without an OS type filter and validates extensions after selection. WebKit testing passed uppercase binary STL with a generic MIME type, lowercase ASCII STL with no MIME type, same-file reimport, a friendly unsupported-file error, and real slicing/export. Physical iPhone verification of the corrected picker is still pending.

The replacement hosting build was tested at `/pocket-slicer/` with no server isolation headers. WebKit gained isolation after one reload, imported a binary STL, and exported 252,604 bytes of real G-code. All engine, icon, source and service-worker URLs stayed under the project path. After saving all 21 offline assets, the HTTP server was shut down; the app reloaded and sliced/exported successfully from its offline copy.

Physical iPhone Safari, its USB drive, the printer's macro configuration and an actual print remain user-side checks. No print was started and no printer configuration was changed. Desktop timing does not predict phone performance.

Run `npm test` and `npm run test:engine` to repeat the shipped automated checks. Browser evidence and additional integration harnesses were retained in the task workspace's `work/` directory.
