import SwiftUI

@main
@MainActor
struct PocketSlicerApp: App {
    @StateObject private var session = SlicerSession()

    var body: some Scene {
        WindowGroup {
            VStack(spacing: 0) {
                if let url = session.baseURL {
                    PocketSlicerWebView(url: url, session: session)
                        .id(url)
                        .allowsHitTesting(session.recoveryMessage == nil)
                        .accessibilityHidden(session.recoveryMessage != nil)
                        .overlay {
                            if let message = session.recoveryMessage {
                                ZStack {
                                    Color(.systemBackground).opacity(0.96)
                                    VStack(spacing: 16) {
                                        Text("Restart Pocket Slicer").font(.title2.bold())
                                        Text(message).multilineTextAlignment(.center)
                                        Button("Restart slicer") { session.restart() }
                                            .buttonStyle(.borderedProminent)
                                            .accessibilityIdentifier("native.restart")
                                    }.padding(28)
                                }.accessibilityIdentifier("native.recovery")
                            }
                        }
                } else if let error = session.startupError {
                    VStack(spacing: 16) {
                        Text("Pocket Slicer").font(.title.bold())
                        Text(error).multilineTextAlignment(.center)
                        Button("Try again") { session.restart() }
                    }.padding()
                } else {
                    ProgressView("Preparing local slicer…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                #if DEBUG
                Text(session.diagnostics)
                    .font(.system(size: 10, design: .monospaced))
                    .lineLimit(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(4)
                    .background(Color(.secondarySystemBackground))
                    .accessibilityIdentifier("native.diagnostics")
                #endif
            }
            .task { session.start() }
        }
    }
}

@MainActor
final class SlicerSession: ObservableObject {
    @Published private(set) var baseURL: URL?
    @Published private(set) var startupError: String?
    @Published private(set) var recoveryMessage: String?
    @Published private(set) var diagnostics = "native: starting"
    private var server: LocalAssetServer?
    private var recentDiagnostics: [String] = []

    func start() {
        guard server == nil else { return }
        do {
            guard let resources = Bundle.main.resourceURL else { throw LocalAssetServer.ServerError.missingAssets }
            let server = try LocalAssetServer(rootURL: resources.appendingPathComponent("web", isDirectory: true))
            self.server = server
            let serverID = ObjectIdentifier(server)
            server.start { [weak self] result in
                // A cancelled startup must not overwrite a later retry's state.
                guard let self = self, let currentServer = self.server,
                      ObjectIdentifier(currentServer) == serverID else { return }
                switch result {
                case .success(let url):
                    self.baseURL = url
                    self.record("native: loopback ready")
                case .failure(let error):
                    self.startupError = error.localizedDescription
                    self.record("native: server failed")
                }
            }
        } catch { startupError = error.localizedDescription }
    }

    func restart() {
        server?.stop()
        server = nil
        baseURL = nil
        startupError = nil
        recoveryMessage = nil
        start()
    }

    func requireRecovery(_ message: String) { recoveryMessage = message }

    func record(_ message: String) {
        recentDiagnostics.append(String(message.prefix(800)))
        if recentDiagnostics.count > 5 { recentDiagnostics.removeFirst(recentDiagnostics.count - 5) }
        diagnostics = recentDiagnostics.joined(separator: "\n")
    }
}
