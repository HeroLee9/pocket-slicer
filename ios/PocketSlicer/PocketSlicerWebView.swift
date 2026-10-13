import SwiftUI
import WebKit

struct PocketSlicerWebView: UIViewRepresentable {
    let url: URL
    @ObservedObject var session: SlicerSession

    func makeCoordinator() -> Coordinator { Coordinator(session: session, origin: url) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // Each launch has a fresh local origin; all assets already live in the app bundle.
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(context.coordinator, name: "pocketDiagnostics")
        configuration.userContentController.addUserScript(WKUserScript(source: Self.diagnosticsScript,
            injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        let view = WKWebView(frame: .zero, configuration: configuration)
        context.coordinator.installNativeExporter(on: view)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.accessibilityIdentifier = "native.webView"
        #if DEBUG
        if #available(iOS 16.4, *) { view.isInspectable = true }
        #endif
        view.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // SwiftUI diagnostics updates must never reload an imported model.
    }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.stopLoading()
        coordinator.cancelNativeExport()
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "pocketDiagnostics")
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: NativeFileExporter.handlerName, contentWorld: .page)
        uiView.navigationDelegate = nil
        uiView.uiDelegate = nil
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        private let session: SlicerSession
        private let origin: URL
        private var exporter: NativeFileExporter?

        init(session: SlicerSession, origin: URL) { self.session = session; self.origin = origin }

        func installNativeExporter(on webView: WKWebView) {
            let exporter = NativeFileExporter(allowedOrigin: origin) { [weak webView] in
                webView?.window?.rootViewController
            }
            self.exporter = exporter
            webView.configuration.userContentController.addScriptMessageHandler(exporter, contentWorld: .page,
                                                                                 name: NativeFileExporter.handlerName)
        }

        func cancelNativeExport() { exporter?.cancelPendingExport() }

        private func isLocal(_ url: URL?) -> Bool {
            guard let url = url else { return false }
            return url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame, isLocal(message.frameInfo.request.url),
                  let body = message.body as? [String: Any], let kind = body["kind"] as? String,
                  let value = body["value"] as? String else { return }
            session.record("\(kind): \(value)")
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            session.record("native: document loaded")
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            session.record("navigation: \(error.localizedDescription)")
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            session.record("navigation: \(error.localizedDescription)")
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            session.record("native: web process terminated; reopen the app to retry")
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if isLocal(navigationAction.request.url) || navigationAction.request.url?.absoluteString == "about:blank" {
                decisionHandler(.allow)
            } else {
                if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url,
                   ["https", "http"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
                decisionHandler(.cancel)
            }
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url {
                if isLocal(url) { webView.load(URLRequest(url: url)) }
                else if ["https", "http"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
            }
            return nil
        }
    }

    private static let diagnosticsScript = #"""
    (() => {
      const send = (kind, value) => {
        try { window.webkit.messageHandlers.pocketDiagnostics.postMessage({kind, value: String(value).slice(0, 800)}); } catch {}
      };
      send('environment', JSON.stringify({secureContext: isSecureContext, crossOriginIsolated,
        sharedArrayBuffer: typeof SharedArrayBuffer === 'function', webAssembly: typeof WebAssembly === 'object'}));
      addEventListener('error', event => send('javascript-error', event.message || 'Unknown error'));
      addEventListener('unhandledrejection', event => send('promise-error', event.reason?.message || event.reason));
    })();
    """#
}
