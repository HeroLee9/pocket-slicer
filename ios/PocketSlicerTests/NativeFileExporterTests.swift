import UIKit
import WebKit
import XCTest
@testable import PocketSlicer

final class NativeFileExporterTests: XCTestCase {
    @MainActor
    func testBridgeRejectsInvalidFilesBeforeOpeningThePicker() async throws {
        let results = try await exerciseBridge(script: #"""
        const bytes = new TextEncoder().encode('G28\nG1 X110 Y110 E0.2\n');
        const valid = {version:1, filename:'cube.gcode', byteLength:bytes.length,
          base64:btoa(String.fromCharCode(...bytes))};
        const cases = [
          ['valid', valid, true],
          ['unicode filename', {...valid, filename:'pièce-测试.gcode'}, true],
          ['wrong version', {...valid, version:2}],
          ['empty file', {...valid, byteLength:0, base64:''}],
          ['oversize declaration', {...valid, byteLength:64*1024*1024+1}],
          ['length mismatch', {...valid, byteLength:bytes.length+1}],
          ['invalid base64', {...valid, base64:'%not-base64%'}],
          ['binary NUL', {...valid, byteLength:2, base64:btoa('\0\n')}],
          ['invalid UTF-8', {...valid, byteLength:1, base64:btoa('\xff')}],
          ...['../cube.gcode','/cube.gcode','a\\b.gcode','.cube.gcode','cube.txt',
             ' cube.gcode','cube.gcode ','a\nb.gcode','a:b.gcode','a?b.gcode',
             ' '.repeat(3)+'.gcode','é'.repeat(100)+'.gcode'].map(filename =>
               ['bad filename '+JSON.stringify(filename), {...valid,filename}])
        ];
        const results = [];
        for (const [name, payload, validPayload] of cases) {
          try {
            const result = await Promise.race([
              window.webkit.messageHandlers.nativeSaveGcode.postMessage(payload),
              new Promise((_, reject) => setTimeout(() => reject(new Error('bridge timeout')), 10000))
            ]);
            results.push({name, validPayload:!!validPayload, result, error:''});
          } catch (error) {
            results.push({name, validPayload:!!validPayload, error:String(error.message || error)});
          }
        }
        return results;
        """#)
        let entries = try XCTUnwrap(results as? [[String: Any]])
        XCTAssertEqual(entries.count, 21)
        for entry in entries {
            let name = entry["name"] as? String ?? "unknown case"
            let error = entry["error"] as? String ?? ""
            if entry["validPayload"] as? Bool == true {
                // A nil presenter intentionally ends a valid request immediately.
                // This tests production decoding without interacting with Files UI.
                XCTAssertTrue(error.contains("Files picker cannot open right now"), "\(name): \(error)")
            } else {
                XCTAssertTrue(error.contains("G-code file is invalid"), "\(name): \(error)")
            }
        }
    }

    @MainActor
    func testBridgeRejectsAnUnexpectedLocalOrigin() async throws {
        let value = try await exerciseBridge(wrongOrigin: true, script: #"""
        try {
          await window.webkit.messageHandlers.nativeSaveGcode.postMessage({
            version:1, filename:'cube.gcode', byteLength:4, base64:btoa('G28\n')
          });
          return 'unexpected success';
        } catch (error) { return String(error.message || error); }
        """#)
        XCTAssertTrue((value as? String ?? "").contains("only available to this app's local main page"))
    }

    @MainActor
    private func exerciseBridge(wrongOrigin: Bool = false, script: String) async throws -> Any? {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try Data("<!doctype html><title>Native export test</title>".utf8).write(to: root.appendingPathComponent("index.html"))
        let server = try LocalAssetServer(rootURL: root)
        defer { server.stop() }
        let baseURL: URL = try await withCheckedThrowingContinuation { continuation in
            server.start { continuation.resume(with: $0) }
        }
        var expectedOrigin = baseURL
        if wrongOrigin {
            var components = try XCTUnwrap(URLComponents(url: baseURL, resolvingAgainstBaseURL: false))
            components.port = baseURL.port == 49_152 ? 49_153 : 49_152
            expectedOrigin = try XCTUnwrap(components.url)
        }
        let exporter = NativeFileExporter(allowedOrigin: expectedOrigin, presenter: { nil })
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.addScriptMessageHandler(exporter, contentWorld: .page,
                                                                     name: NativeFileExporter.handlerName)
        let webView = WKWebView(frame: UIScreen.main.bounds, configuration: configuration)
        let controller = UIViewController()
        controller.view = webView
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        defer {
            exporter.cancelPendingExport()
            configuration.userContentController.removeScriptMessageHandler(forName: NativeFileExporter.handlerName, contentWorld: .page)
            webView.stopLoading()
            window.isHidden = true
        }
        let loaded = expectation(description: "Native export bridge fixture loads")
        let observer = ExportNavigationObserver(loaded: loaded)
        webView.navigationDelegate = observer
        webView.load(URLRequest(url: baseURL))
        await fulfillment(of: [loaded], timeout: 20)
        if let error = observer.error { throw error }
        return try await webView.callAsyncJavaScript(script, arguments: [:], in: nil, contentWorld: .page)
    }
}

@MainActor
private final class ExportNavigationObserver: NSObject, WKNavigationDelegate {
    let loaded: XCTestExpectation
    var error: Error?
    private var completed = false

    init(loaded: XCTestExpectation) { self.loaded = loaded }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finish() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        finish(NSError(domain: "PocketSlicerExportTest", code: 1))
    }
    private func finish(_ error: Error? = nil) {
        guard !completed else { return }
        completed = true
        self.error = error
        loaded.fulfill()
    }
}
