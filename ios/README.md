# Installed iPhone app

This target bundles Pocket Slicer and the Orca WebAssembly engine inside an iOS application. It serves the bundled files only over a loopback connection inside the phone and displays them in `WKWebView`. No public website, remote slicing service, or always-on PC is involved during use.

## Current status

The iOS project and native engine test are prepared. Native compilation and the iOS simulator test must pass before an installable package is considered ready. Browser WebKit tests alone do not verify this native configuration. Physical iPhone import, memory usage and USB export also require device testing.

## Build and test

The GitHub Actions workflow **Build and test local iPhone app** uses a hosted Mac. It is manual and will run only in a public repository, where standard GitHub-hosted runners are free. It does not publish a website. Source code is public if that option is used; models and G-code are never included in the build or uploaded by the app.

The workflow installs dependencies, bundles the web app at `/`, generates the Xcode project, and runs `LocalSlicingTests` inside an iOS simulator. This test verifies cross-origin isolation, shared WebAssembly memory and actual Orca slicing through the bundled worker. Only after the test passes does it produce an unsigned device `.ipa` for sideloading. Native test results are retained as an artifact. No signing credentials are stored in the repository.

For a developer who already has a Mac, the equivalent preparation is:

```sh
npm ci
python3 scripts/package-source.py
node scripts/prepare-ios.mjs --include-probe
xcodegen generate --spec ios/project.yml
```

Open the generated project to run the `PocketSlicer` test scheme. For a release package, run `node scripts/prepare-ios.mjs` without the probe flag before building. Generated web bundles, Xcode projects, build results and signing material are excluded from source control.

## Free installation

An unsigned `.ipa` cannot be installed by tapping it in Files. It must be signed for the device. A possible free route is SideStore, using a free Apple Account and an initial USB setup on Linux through iloader. Apple signing expires after seven days and requires renewal; SideStore can renew on the phone after setup. It consumes one of the three free sideloaded-app slots itself.

The user enters Apple credentials in the sideloading tool, never in Pocket Slicer or a chat. Developer Mode and device trust are user-controlled setup steps. SideStore compatibility and refresh reliability must be checked against the actual iOS version; current upstream releases include alpha software and reported renewal issues. Do not treat free sideloading as a permanent, maintenance-free install.

Official setup and current release information:

- https://docs.sidestore.io/docs/installation/prerequisites
- https://docs.sidestore.io/docs/installation/install
- https://docs.sidestore.io/docs/faq
- https://github.com/SideStore/SideStore/releases

After installation, import a model through Files, slice it, and tap **Save G-code**. The native export picker lets the user choose a connected USB drive. The app never starts a print automatically.
