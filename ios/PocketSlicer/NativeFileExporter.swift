import Foundation
import UIKit
import WebKit

/// Exports locally generated G-code through the system Files picker, including USB.
/// Retain this object in the WKWebView coordinator and register it in `.page` with
/// `addScriptMessageHandler(_:contentWorld:name:)`, named `nativeSaveGcode`.
@MainActor
final class NativeFileExporter: NSObject, WKScriptMessageHandlerWithReply, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
    static let handlerName = "nativeSaveGcode"
    static let maximumFileBytes = 64 * 1024 * 1024

    private typealias Reply = @MainActor @Sendable (Any?, String?) -> Void
    private let allowedOrigin: URL
    private let presenter: () -> UIViewController?
    private var pendingReply: Reply?
    private var activePicker: UIDocumentPickerViewController?
    private var activeDirectory: URL?
    private var activeFilename: String?

    init(allowedOrigin: URL, presenter: @escaping () -> UIViewController?) {
        self.allowedOrigin = allowedOrigin
        self.presenter = presenter
        super.init()
        removeAbandonedTemporaryFiles()
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
    ) {
        guard message.name == Self.handlerName, isAllowed(message) else {
            replyHandler(nil, "Files export is only available to this app's local main page.")
            return
        }
        guard pendingReply == nil else {
            replyHandler(nil, "A Files export is already open. Finish or cancel it first.")
            return
        }
        guard let body = message.body as? [String: Any],
              body["version"] as? Int == 1,
              let filename = body["filename"] as? String,
              validFilename(filename),
              let byteLength = body["byteLength"] as? Int,
              byteLength > 0, byteLength <= Self.maximumFileBytes,
              let encoded = body["base64"] as? String,
              encoded.utf8.count <= ((Self.maximumFileBytes + 2) / 3) * 4,
              let data = Data(base64Encoded: encoded),
              data.count == byteLength,
              !data.contains(0),
              String(data: data, encoding: .utf8) != nil else {
            replyHandler(nil, "The G-code file is invalid, has an invalid name, or exceeds the 64 MB export limit.")
            return
        }
        guard var host = presenter(), host.viewIfLoaded?.window != nil else {
            replyHandler(nil, "The Files picker cannot open right now. Return to the app and try again.")
            return
        }
        while let presented = host.presentedViewController {
            guard !presented.isBeingDismissed else {
                replyHandler(nil, "Another view is closing. Try saving again.")
                return
            }
            host = presented
        }

        let directory = Self.exportRoot.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let file = directory.appendingPathComponent(filename, isDirectory: false)
            try data.write(to: file, options: [.atomic])
            let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            picker.modalPresentationStyle = .formSheet
            activeDirectory = directory
            activeFilename = filename
            activePicker = picker
            pendingReply = replyHandler
            host.present(picker, animated: true) { [weak self, weak picker] in
                picker?.presentationController?.delegate = self
            }
        } catch {
            try? FileManager.default.removeItem(at: directory)
            replyHandler(nil, "The temporary G-code file could not be prepared. Check free storage and try again.")
        }
    }

    private func isAllowed(_ message: WKScriptMessage) -> Bool {
        guard message.frameInfo.isMainFrame,
              allowedOrigin.scheme == "http",
              allowedOrigin.host?.lowercased() == "localhost",
              let port = allowedOrigin.port, (1...65_535).contains(port),
              message.frameInfo.securityOrigin.protocol == "http",
              message.frameInfo.securityOrigin.host.lowercased() == "localhost",
              message.frameInfo.securityOrigin.port == port,
              let page = message.webView?.url,
              page.scheme == "http", page.host?.lowercased() == "localhost",
              page.port == port, page.user == nil, page.password == nil else {
            return false
        }
        return true
    }

    private func validFilename(_ filename: String) -> Bool {
        let forbidden = CharacterSet.controlCharacters.union(CharacterSet(charactersIn: "/\\<>:\"|?*"))
        return filename.hasSuffix(".gcode")
            && filename.utf8.count <= 200
            && !filename.hasPrefix(".")
            && filename == filename.trimmingCharacters(in: .whitespacesAndNewlines)
            && !filename.dropLast(6).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && filename.unicodeScalars.allSatisfy { !forbidden.contains($0) }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard controller === activePicker else { return }
        // In export mode these URLs refer to copies already made at the user's
        // destination. No security-scoped access is needed to write them again.
        if urls.isEmpty { finish(status: "cancelled") }
        else { finish(status: "saved") }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard controller === activePicker else { return }
        finish(status: "cancelled")
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        guard presentationController.presentedViewController === activePicker else { return }
        finish(status: "cancelled")
    }

    /// Call from UIViewRepresentable.dismantleUIView before removing this handler.
    func cancelPendingExport() {
        activePicker?.dismiss(animated: false)
        finish(status: "cancelled")
    }

    private func finish(status: String) {
        guard let reply = pendingReply else { return }
        let filename = activeFilename ?? "K1C-print.gcode"
        let directory = activeDirectory
        pendingReply = nil
        activePicker = nil
        activeDirectory = nil
        activeFilename = nil
        if let directory { try? FileManager.default.removeItem(at: directory) }
        reply(["status": status, "filename": filename], nil)
    }

    private static var exportRoot: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("PocketSlicerExports", isDirectory: true)
    }

    private func removeAbandonedTemporaryFiles() {
        // A process termination may leave a source file behind. Only remove
        // stale files in this app-owned temporary folder, never user destinations.
        let manager = FileManager.default
        guard let entries = try? manager.contentsOfDirectory(
            at: Self.exportRoot,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else { return }
        let cutoff = Date().addingTimeInterval(-86_400)
        for entry in entries {
            if let values = try? entry.resourceValues(forKeys: [.contentModificationDateKey]),
               let date = values.contentModificationDate, date < cutoff {
                try? manager.removeItem(at: entry)
            }
        }
    }
}
