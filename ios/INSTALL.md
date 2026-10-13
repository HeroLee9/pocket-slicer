# Install Pocket Slicer on an iPhone from Linux

Pocket Slicer runs and slices inside the installed iPhone app. The PC is used for initial signing/setup, and sometimes recovery. It can be switched off during slicing and USB export. Free Apple signing still needs renewal every seven days.

Use the **PocketSlicer-unsigned.ipa** produced by a successful native build. If downloading the `PocketSlicer-unsigned` build artifact, unzip it first. Tapping an unsigned IPA in Files does not install it. Physical iPhone 18 Pro operation, including the installed iOS version and USB drive, must still be tested.

## 1. Prepare this Arch/Omarchy PC

Read-only checks on October 13, 2026 found `libimobiledevice` and `webkit2gtk-4.1` installed, but no `usbmuxd`, no `fuse2`, and no connected iPhone. No software or services were changed.

The following commands are setup instructions to run when ready:

```sh
sudo pacman -S --needed usbmuxd fuse2
```

These are the [SideStore Linux USB prerequisite](https://docs.sidestore.io/docs/installation/prerequisites), the official [Arch usbmuxd package](https://archlinux.org/packages/extra/x86_64/usbmuxd/), and the [AppImage FUSE requirement on Arch](https://docs.appimage.org/user-guide/troubleshooting/fuse.html#setting-up-fuse-on-arch-linux).

The official **iloader v2.3.7 x86_64 AppImage** is already downloaded at `work/downloads/iloader-v2.3.7-linux-amd64.AppImage` relative to the original workspace. Its SHA-256 matches the [official release asset metadata](https://api.github.com/repos/nab138/iloader/releases/tags/v2.3.7):

```text
45d95d131a7964b7dbd0c933914a8aea2d55060b702c93ef84950f2940de8aca
```

If needed, [download that same release directly](https://github.com/nab138/iloader/releases/download/v2.3.7/iloader-linux-amd64.AppImage). In the folder containing it, make the file executable and open it:

```sh
chmod +x iloader-v2.3.7-linux-amd64.AppImage
./iloader-v2.3.7-linux-amd64.AppImage
```

For a fresh download, substitute its filename `iloader-linux-amd64.AppImage` in those commands. This version fixes an Apple login failure, but its release notes identify **SMS two-factor authentication as temporarily broken**. Use the trusted-device verification prompt on your iPhone; SMS-only login may block setup. [iloader v2.3.7 release notes](https://github.com/nab138/iloader/releases/tag/v2.3.7).

## 2. Set up SideStore once

1. On the iPhone, install [LocalDevVPN from the App Store](https://apps.apple.com/app/localdevvpn/id6755608044). Connect it and allow its VPN configuration. Join Wi-Fi.
2. Connect the unlocked iPhone to this PC with a USB data cable. Tap **Trust** on the phone and enter its passcode.
3. In iloader, enter your Apple Account yourself, complete verification, select the phone, and choose **Install SideStore (Stable)**.
4. On iOS 18 or later, open **Settings → General → VPN & Device Management → Developer App**, select your Apple Account, and use **Trust → Allow & Restart**. Then enable **Settings → Privacy & Security → Developer Mode** and complete its restart prompts.
5. With LocalDevVPN connected, open SideStore and sign in with the same Apple Account. In **My Apps**, tap SideStore's day counter to refresh SideStore itself **before adding Pocket Slicer**. Wait for it to finish and reopen SideStore.

These steps follow the [official installation guide](https://docs.sidestore.io/docs/installation/install). As checked October 13, 2026, the button labeled **Stable** downloads GitHub's latest release, currently **0.7.0-alpha**. This is alpha software: upstream says 0.6.4 and earlier cannot sign in after Apple server changes. [Installer implementation](https://github.com/nab138/iloader/blob/v2.3.7/src-tauri/src/sideload.rs#L95), [SideStore release notes](https://github.com/SideStore/SideStore/releases/tag/0.7.0-alpha).

## 3. Install the IPA and save to USB

1. Copy `PocketSlicer-unsigned.ipa` to a USB drive using the PC. Connect the drive to your iPhone. In Files, copy the IPA to **On My iPhone** if convenient.
2. Keep Wi-Fi and LocalDevVPN connected. Open **SideStore → My Apps → +** and choose that IPA from Files. SideStore signs and installs it. The plus button opens the system file picker in the [current SideStore source](https://github.com/SideStore/SideStore/blob/0.7.0-alpha/AltStore/My%20Apps/MyAppsViewController.swift#L921).
3. Open **Pocket Slicer** from the Home Screen. Import a small model, verify the K1C nozzle/material settings, and slice it. Tap **Save G-code**, choose the connected drive in the Files export picker, and save. Move the drive to the printer and select the file there.

Pocket Slicer bundles its slicing engine. Internet, LocalDevVPN and the PC are not needed for ordinary local slicing or USB export.

## Keep the free install working

Before the seven-day timer expires, connect the iPhone to Wi-Fi, turn on LocalDevVPN, and refresh **both SideStore and Pocket Slicer** in SideStore. Do not rely on background refresh until it has worked on your phone. A free Apple Account permits three active sideloaded apps including SideStore; these two apps use two slots. [SideStore FAQ](https://docs.sidestore.io/docs/faq), [VPN/Wi-Fi requirements](https://docs.sidestore.io/docs/installation/prerequisites).

An expired app or pairing record can require the PC again. Pairing records may need replacement after an iOS update/reset or other failures. The [official recovery instructions](https://docs.sidestore.io/docs/installation/install) are linked from the installation guide. This route is not a promise of reliable renewal on an untested iOS version.
