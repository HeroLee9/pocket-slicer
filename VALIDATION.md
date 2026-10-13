# Validation — October 13, 2026

This app uses the actual pinned OrcaWasm engine in a browser worker; these results are from local production builds on Linux, not from an iPhone or a physical printer.

- 26 unit tests passed for settings, profiles, G-code preview parsing, printable bounds and file delivery.
- Eight actual engine configurations passed: PLA, PETG, ABS, 0.6 mm and 0.8 mm nozzles, 100% infill, normal supports and tree supports. Generated motion, temperatures, extrusion and K1C start/end macros were checked.
- The default 20 mm cube produced 252,604 bytes of G-code, 100 layers and 6,219 extrusion moves. Orca estimated 3.73 g and 17 minutes 29 seconds.
- Chromium and WebKit passed model import, real slicing, layer preview and G-code download. Mobile and desktop layouts were inspected. Cancellation, invalid input, retry, empty numeric fields and invalidation of stale output were exercised.
- Offline storage was completed, the local server was stopped, and the app reloaded, sliced and exported successfully without a network connection. Redirected authentication pages and mismatched asset hashes were rejected during offline preparation.
- The production build was also served without isolation headers. Chromium and WebKit each reloaded exactly once, gained cross-origin isolation and sliced/exported the cube with no console errors. Servers that supplied the headers needed no setup reload. Authentication routes, redirects and inline sign-in pages remained unchanged.

The original iPhone test exposed an overly restrictive file picker: iOS disabled STL files. The picker now allows file selection without an OS type filter and validates extensions after selection. WebKit testing passed uppercase binary STL with a generic MIME type, lowercase ASCII STL with no MIME type, same-file reimport, a friendly unsupported-file error, and real slicing/export. Physical iPhone verification of the corrected picker is still pending.

The replacement hosting build was tested at `/pocket-slicer/` with no server isolation headers. WebKit gained isolation after one reload, imported a binary STL, and exported 252,604 bytes of real G-code. All engine, icon, source and service-worker URLs stayed under the project path. After saving all 21 offline assets, the HTTP server was shut down; the app reloaded and sliced/exported successfully from its offline copy.

Physical iPhone Safari, its USB drive, the printer's macro configuration and an actual print remain user-side checks. No print was started and no printer configuration was changed. Desktop timing does not predict phone performance.

Run `npm test` and `npm run test:engine` to repeat the shipped automated checks. Browser evidence and additional integration harnesses were retained in the task workspace's `work/` directory.
