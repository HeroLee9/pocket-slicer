import Foundation
import Network

/// Serves the app's immutable bundle over real loopback HTTP. No LAN binding,
/// uploads, proxying, or arbitrary filesystem access is supported.
final class LocalAssetServer {
    enum ServerError: LocalizedError {
        case missingAssets, unavailablePort, alreadyStarted
        var errorDescription: String? {
            switch self {
            case .missingAssets: return "The bundled web assets are missing. Run the iOS asset preparation script before building."
            case .unavailablePort: return "The local asset server could not obtain a loopback port."
            case .alreadyStarted: return "The local asset server is already running."
            }
        }
    }

    private let rootURL: URL
    private let queue = DispatchQueue(label: "PocketSlicer.LocalAssets", qos: .userInitiated)
    private var listener: NWListener?
    private var connections: [UUID: HTTPAssetConnection] = [:]
    private var startupCompletion: ((Result<URL, Error>) -> Void)?
    private let maximumConnections = 24

    init(rootURL: URL) throws {
        let root = rootURL.standardizedFileURL.resolvingSymlinksInPath()
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: root.path, isDirectory: &isDirectory), isDirectory.boolValue,
              FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            throw ServerError.missingAssets
        }
        self.rootURL = root
    }

    /// The completion is delivered once on the main queue.
    func start(completion: @escaping (Result<URL, Error>) -> Void) {
        queue.async { [weak self] in
            guard let self = self else { return }
            guard self.listener == nil else {
                DispatchQueue.main.async { completion(.failure(ServerError.alreadyStarted)) }
                return
            }
            self.startupCompletion = completion
            do {
                let parameters = NWParameters.tcp
                // requiredLocalEndpoint is essential: .tcp alone would listen on every interface.
                parameters.requiredLocalEndpoint = .hostPort(host: NWEndpoint.Host("127.0.0.1"), port: .any)
                let listener = try NWListener(using: parameters)
                self.listener = listener
                listener.stateUpdateHandler = { [weak self, weak listener] state in
                    guard let self = self, let listener = listener, self.listener === listener else { return }
                    switch state {
                    case .ready:
                        guard let port = listener.port,
                              let url = URL(string: "http://localhost:\(port.rawValue)/") else {
                            self.completeStartup(.failure(ServerError.unavailablePort))
                            listener.cancel()
                            return
                        }
                        self.completeStartup(.success(url))
                    case .failed(let error):
                        self.completeStartup(.failure(error))
                        listener.cancel()
                        self.listener = nil
                    case .cancelled:
                        self.completeStartup(.failure(ServerError.unavailablePort))
                    default: break
                    }
                }
                listener.newConnectionHandler = { [weak self, weak listener] connection in
                    guard let self = self, let port = listener?.port,
                          self.connections.count < self.maximumConnections else {
                        connection.cancel()
                        return
                    }
                    let identifier = UUID()
                    let handler = HTTPAssetConnection(connection: connection, rootURL: self.rootURL,
                                                      port: port.rawValue, queue: self.queue) { [weak self] in
                        self?.connections.removeValue(forKey: identifier)
                    }
                    self.connections[identifier] = handler
                    handler.start()
                }
                listener.start(queue: self.queue)
            } catch {
                self.listener = nil
                self.completeStartup(.failure(error))
            }
        }
    }

    func stop() {
        // Retain through cancellation even if the owner releases the server immediately.
        queue.async {
            self.listener?.cancel()
            self.listener = nil
            let active = Array(self.connections.values)
            self.connections.removeAll()
            active.forEach { $0.cancel() }
            self.completeStartup(.failure(ServerError.unavailablePort))
        }
    }

    private func completeStartup(_ result: Result<URL, Error>) {
        guard let completion = startupCompletion else { return }
        startupCompletion = nil
        DispatchQueue.main.async { completion(result) }
    }
}

private final class HTTPAssetConnection {
    private let connection: NWConnection
    private let rootURL: URL
    private let port: UInt16
    private let queue: DispatchQueue
    private let onFinish: () -> Void
    private var received = Data()
    private var finished = false
    private var file: FileHandle?
    private var remainingBytes = 0
    private var deadline: DispatchWorkItem?
    private let maximumHeaderBytes = 16 * 1024
    private let maximumAssetBytes = 64 * 1024 * 1024
    private let chunkBytes = 64 * 1024

    init(connection: NWConnection, rootURL: URL, port: UInt16, queue: DispatchQueue, onFinish: @escaping () -> Void) {
        self.connection = connection
        self.rootURL = rootURL
        self.port = port
        self.queue = queue
        self.onFinish = onFinish
    }

    func start() {
        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled: self?.cancel()
            default: break
            }
        }
        connection.start(queue: queue)
        setDeadline(seconds: 10)
        receiveHeader()
    }

    func cancel() {
        guard !finished else { return }
        finished = true
        deadline?.cancel()
        deadline = nil
        try? file?.close()
        file = nil
        connection.stateUpdateHandler = nil
        connection.cancel()
        onFinish()
    }

    private func setDeadline(seconds: Double) {
        deadline?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.cancel() }
        deadline = work
        queue.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    private func receiveHeader() {
        guard !finished else { return }
        connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, complete, error in
            guard let self = self, !self.finished else { return }
            if let data = data { self.received.append(data) }
            if let end = self.received.range(of: Data("\r\n\r\n".utf8)) {
                guard end.upperBound <= self.maximumHeaderBytes else { self.sendError(431, "Request Header Fields Too Large"); return }
                let header = self.received.subdata(in: 0..<end.lowerBound)
                self.received.removeAll(keepingCapacity: false)
                self.handleHeader(header)
            } else if self.received.count >= self.maximumHeaderBytes {
                self.sendError(431, "Request Header Fields Too Large")
            } else if complete || error != nil {
                self.cancel()
            } else {
                self.receiveHeader()
            }
        }
    }

    private func handleHeader(_ data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { sendError(400, "Bad Request"); return }
        let lines = text.components(separatedBy: "\r\n")
        let request = (lines.first ?? "").split(separator: " ", omittingEmptySubsequences: false)
        guard request.count == 3, request[0].count <= 8, request[1].utf8.count <= 4096,
              ["HTTP/1.0", "HTTP/1.1"].contains(String(request[2])) else { sendError(400, "Bad Request"); return }
        let method = String(request[0])
        guard method == "GET" || method == "HEAD" else { sendError(405, "Method Not Allowed", extra: "Allow: GET, HEAD\r\n"); return }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":"), colon != line.startIndex,
                  !line.hasPrefix(" "), !line.hasPrefix("\t") else { sendError(400, "Bad Request"); return }
            let key = line[..<colon].lowercased()
            guard headers[key] == nil else { sendError(400, "Bad Request"); return }
            headers[key] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        let allowedHosts = ["localhost:\(port)", "127.0.0.1:\(port)"]
        guard let host = headers["host"]?.lowercased(), allowedHosts.contains(host) else { sendError(403, "Forbidden"); return }
        guard headers["transfer-encoding"] == nil,
              headers["content-length"] == nil || headers["content-length"] == "0" else { sendError(400, "Bad Request"); return }
        guard let asset = resolveAsset(String(request[1])) else { sendError(404, "Not Found"); return }
        do {
            let values = try asset.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
            guard values.isRegularFile == true, let size = values.fileSize, size >= 0, size <= maximumAssetBytes else {
                sendError(404, "Not Found"); return
            }
            // The slicer fetches entire assets. Explicitly decline Range rather than silently truncate WASM.
            if headers["range"] != nil {
                sendError(416, "Range Not Satisfiable", extra: "Content-Range: bytes */\(size)\r\n")
                return
            }
            let response = responseHeader(status: 200, reason: "OK", type: mimeType(asset), length: size)
            if method == "HEAD" || size == 0 {
                connection.send(content: Data(response.utf8), contentContext: .finalMessage, isComplete: true,
                                completion: .contentProcessed { [weak self] _ in self?.cancel() })
                return
            }
            file = try FileHandle(forReadingFrom: asset)
            remainingBytes = size
            setDeadline(seconds: 60)
            connection.send(content: Data(response.utf8), completion: .contentProcessed { [weak self] error in
                guard let self = self else { return }
                if error != nil { self.cancel() } else { self.sendNextChunk() }
            })
        } catch {
            sendError(404, "Not Found")
        }
    }

    private func resolveAsset(_ target: String) -> URL? {
        guard target.hasPrefix("/"), !target.hasPrefix("//"), !target.contains("#"),
              let decoded = target.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first
                .flatMap({ String($0).removingPercentEncoding }),
              !decoded.contains("\\"), decoded.rangeOfCharacter(from: .controlCharacters) == nil else { return nil }
        let parts = decoded.split(separator: "/", omittingEmptySubsequences: true)
        guard !parts.contains(".."), !parts.contains(".") else { return nil }
        let relative = decoded == "/" ? "index.html" : String(decoded.dropFirst())
        let candidate = rootURL.appendingPathComponent(relative).standardizedFileURL.resolvingSymlinksInPath()
        guard candidate.path.hasPrefix(rootURL.path + "/") else { return nil }
        return candidate
    }

    private func sendNextChunk() {
        guard !finished, let file = file else { return }
        guard remainingBytes > 0 else {
            connection.send(content: nil, contentContext: .finalMessage, isComplete: true,
                            completion: .contentProcessed { [weak self] _ in self?.cancel() })
            return
        }
        do {
            guard let bytes = try file.read(upToCount: min(chunkBytes, remainingBytes)), !bytes.isEmpty else { cancel(); return }
            remainingBytes -= bytes.count
            connection.send(content: bytes, completion: .contentProcessed { [weak self] error in
                guard let self = self else { return }
                if error != nil { self.cancel() } else { self.sendNextChunk() }
            })
        } catch { cancel() }
    }

    private func sendError(_ status: Int, _ reason: String, extra: String = "") {
        guard !finished else { return }
        let body = Data("\(status) \(reason)\n".utf8)
        var response = Data(responseHeader(status: status, reason: reason, type: "text/plain; charset=utf-8", length: body.count, extra: extra).utf8)
        response.append(body)
        connection.send(content: response, contentContext: .finalMessage, isComplete: true,
                        completion: .contentProcessed { [weak self] _ in self?.cancel() })
    }

    private func responseHeader(status: Int, reason: String, type: String, length: Int, extra: String = "") -> String {
        "HTTP/1.1 \(status) \(reason)\r\nContent-Type: \(type)\r\nContent-Length: \(length)\r\nConnection: close\r\nCache-Control: no-store\r\nCross-Origin-Opener-Policy: same-origin\r\nCross-Origin-Embedder-Policy: require-corp\r\nCross-Origin-Resource-Policy: same-origin\r\nX-Content-Type-Options: nosniff\r\nService-Worker-Allowed: /\r\n\(extra)\r\n"
    }

    private func mimeType(_ url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json"
        case "webmanifest": return "application/manifest+json"
        case "wasm": return "application/wasm"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "txt", "md", "gcode": return "text/plain; charset=utf-8"
        case "zip": return "application/zip"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }
}
