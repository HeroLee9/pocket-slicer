import XCTest
import UIKit
import WebKit
@testable import PocketSlicer

final class LocalSlicingTests: XCTestCase {
    /// Exercises the public iOS WKWebView API and the exact bundled Orca worker.
    /// Linux WebKit and Safari browser tests cannot establish this compatibility.
    @MainActor
    func testBundledOrcaSlicesInsideWKWebView() async throws {
        let resources = try XCTUnwrap(Bundle.main.resourceURL)
        let webRoot = resources.appendingPathComponent("web", isDirectory: true)
        XCTAssertTrue(FileManager.default.fileExists(atPath: webRoot.appendingPathComponent("native-test/probe.html").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: webRoot.appendingPathComponent("engine/pocket-worker.js").path))

        let server = try LocalAssetServer(rootURL: webRoot)
        defer { server.stop() }
        let baseURL: URL = try await withCheckedThrowingContinuation { continuation in
            server.start { result in continuation.resume(with: result) }
        }

        // No private preferences, injected isolation flags, or alternate WebKit engine.
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let webView = WKWebView(frame: UIScreen.main.bounds, configuration: configuration)
        let viewController = UIViewController()
        viewController.view = webView
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = viewController
        window.makeKeyAndVisible()
        defer {
            webView.stopLoading()
            window.isHidden = true
        }

        let loaded = expectation(description: "Bundled probe loads from the in-app loopback server")
        let observer = ProbeNavigationObserver(loaded: loaded)
        webView.navigationDelegate = observer
        webView.load(URLRequest(url: baseURL.appendingPathComponent("native-test/probe.html")))
        await fulfillment(of: [loaded], timeout: 30)
        if let error = observer.error { throw error }

        let value = try await webView.callAsyncJavaScript(Self.engineProbe, arguments: [:], in: nil, contentWorld: .page)
        var report = try XCTUnwrap(value as? [String: Any])
        let gcode = try XCTUnwrap(report.removeValue(forKey: "gcode") as? String)

        XCTAssertEqual(report["secure"] as? Bool, true)
        XCTAssertEqual(report["isolated"] as? Bool, true)
        XCTAssertEqual(report["sharedArrayBuffer"] as? Bool, true)
        XCTAssertEqual(report["sharedWasmMemory"] as? Bool, true)
        XCTAssertEqual(report["engine"] as? String, "OrcaSlicer")
        XCTAssertEqual(report["version"] as? String, "2.4.2")
        XCTAssertEqual(report["apiVersion"] as? String, "0.7.0")
        XCTAssertEqual((report["layers"] as? NSNumber)?.intValue, 100)
        XCTAssertGreaterThan((report["bytes"] as? NSNumber)?.intValue ?? 0, 100_000)
        XCTAssertGreaterThan((report["extrusionMoves"] as? NSNumber)?.intValue ?? 0, 100)
        XCTAssertGreaterThan((report["progressEvents"] as? NSNumber)?.intValue ?? 0, 0)
        XCTAssertTrue(gcode.contains("START_PRINT"))
        XCTAssertTrue(gcode.contains("END_PRINT"))
        XCTAssertTrue(gcode.contains("M83"))

        let reportData = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        let reportText = String(decoding: reportData, as: UTF8.self)
        print("POCKET_NATIVE_PROBE_REPORT: \(reportText)")
        let reportAttachment = XCTAttachment(string: reportText)
        reportAttachment.name = "Native WKWebView engine probe"
        reportAttachment.lifetime = .keepAlways
        add(reportAttachment)
        let gcodeAttachment = XCTAttachment(string: gcode)
        gcodeAttachment.name = "native-calibration-cube.gcode"
        gcodeAttachment.lifetime = .keepAlways
        add(gcodeAttachment)
    }

    private static let engineProbe = #"""
    const diagnostic = {
      href: location.href,
      userAgent: navigator.userAgent,
      secure: isSecureContext,
      isolated: crossOriginIsolated,
      sharedArrayBuffer: typeof SharedArrayBuffer === 'function'
    };
    if (!diagnostic.secure || !diagnostic.isolated || !diagnostic.sharedArrayBuffer) {
      throw new Error('Native isolation probe failed: ' + JSON.stringify(diagnostic));
    }
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true });
    diagnostic.sharedWasmMemory = memory.buffer instanceof SharedArrayBuffer;
    if (!diagnostic.sharedWasmMemory) throw new Error('Shared WebAssembly memory is unavailable.');
    const response = await fetch(new URL('k1c-config.json', location.href));
    if (!response.ok) throw new Error('K1C config fixture missing: HTTP ' + response.status);
    const config = await response.json();
    const worker = new Worker(new URL('../engine/pocket-worker.js', location.href));
    let sequence = 0;
    let progressEvents = 0;
    const requests = new Map();
    const rpc = (type, payload) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        requests.delete(id);
        reject(new Error('Native Orca request timed out: ' + type));
      }, 120000);
      requests.set(id, { resolve, reject, timer });
      worker.postMessage({ type, id, payload });
    });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { progressEvents++; return; }
      const request = requests.get(data.id);
      if (!request) return;
      clearTimeout(request.timer);
      requests.delete(data.id);
      if (data.type === 'error') request.reject(new Error(data.error?.message || 'Orca worker failed.'));
      else if (data.type === 'result') request.resolve(data.result);
    };
    worker.onerror = event => {
      for (const request of requests.values()) {
        clearTimeout(request.timer);
        request.reject(new Error(event.message || 'Native worker script failed.'));
      }
      requests.clear();
    };
    try {
      const engine = await rpc('initialize');
      const vertices = [[0,0,0],[20,0,0],[20,20,0],[0,20,0],[0,0,20],[20,0,20],[20,20,20],[0,20,20]];
      const triangles = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
      const stl = new ArrayBuffer(84 + triangles.length * 50);
      const view = new DataView(stl);
      view.setUint32(80, triangles.length, true);
      triangles.forEach((triangle,i) => triangle.forEach((vertex,j) => vertices[vertex].forEach((v,axis) => view.setFloat32(84+i*50+12+j*12+axis*4,v,true))));
      const result = await rpc('slice', { stl, name:'native-calibration-cube.stl', config });
      const text = new TextDecoder().decode(result.gcode);
      return {
        ...diagnostic,
        engine:engine.name,
        version:engine.version,
        apiVersion:engine.apiVersion,
        release:engine.release,
        bytes:result.gcode.byteLength,
        layers:result.layerCount,
        extrusionMoves:(text.match(/^G[01]\s.*\bE[-\d.]+/gm) || []).length,
        progressEvents,
        elapsedMs:result.elapsedMs,
        statisticsJSON:JSON.stringify(result.statistics),
        gcode:text
      };
    } finally {
      worker.terminate();
      for (const request of requests.values()) clearTimeout(request.timer);
      requests.clear();
    }
    """#
}

@MainActor
private final class ProbeNavigationObserver: NSObject, WKNavigationDelegate {
    let loaded: XCTestExpectation
    var error: Error?

    init(loaded: XCTestExpectation) { self.loaded = loaded }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded.fulfill()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        self.error = error
        loaded.fulfill()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        self.error = error
        loaded.fulfill()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        self.error = NSError(domain: "PocketSlicerNativeProbe", code: 1, userInfo: [NSLocalizedDescriptionKey:"WKWebView content process terminated."])
        loaded.fulfill()
    }
}
