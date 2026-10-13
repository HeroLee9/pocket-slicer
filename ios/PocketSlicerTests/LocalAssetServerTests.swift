import CryptoKit
import Foundation
import Network
import XCTest
@testable import PocketSlicer

final class LocalAssetServerTests: XCTestCase {
    func testBundledWasmArrivesIntactWithIsolationHeaders() async throws {
        let root = try XCTUnwrap(Bundle.main.resourceURL).appendingPathComponent("web", isDirectory: true)
        let server = try LocalAssetServer(rootURL: root)
        defer { server.stop() }
        let baseURL = try await start(server)
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }

        let (index, indexResponse) = try await session.data(from: baseURL)
        let http = try XCTUnwrap(indexResponse as? HTTPURLResponse)
        XCTAssertEqual(http.statusCode, 200)
        XCTAssertEqual(http.value(forHTTPHeaderField: "Cross-Origin-Opener-Policy"), "same-origin")
        XCTAssertEqual(http.value(forHTTPHeaderField: "Cross-Origin-Embedder-Policy"), "require-corp")
        XCTAssertEqual(http.value(forHTTPHeaderField: "Cross-Origin-Resource-Policy"), "same-origin")
        XCTAssertEqual(http.value(forHTTPHeaderField: "Cache-Control"), "no-store")
        XCTAssertEqual(index, try Data(contentsOf: root.appendingPathComponent("index.html")))

        // Both chunks exceed many ordinary HTTP buffer sizes. Check the complete
        // release digest, not just a successful status or the first WASM bytes.
        var digest = SHA256()
        var total = 0
        for filename in ["slicer-mt.wasm.part0", "slicer-mt.wasm.part1"] {
            let path = "engine/" + filename
            let (data, response) = try await session.data(from: baseURL.appendingPathComponent(path))
            let assetResponse = try XCTUnwrap(response as? HTTPURLResponse)
            XCTAssertEqual(assetResponse.statusCode, 200)
            XCTAssertEqual(assetResponse.value(forHTTPHeaderField: "Content-Type"), "application/octet-stream")
            XCTAssertEqual(assetResponse.expectedContentLength, Int64(data.count))
            XCTAssertEqual(data, try Data(contentsOf: root.appendingPathComponent(path)), filename)
            digest.update(data: data)
            total += data.count
        }
        XCTAssertEqual(total, 29_019_444)
        XCTAssertEqual(digest.finalize().map { String(format: "%02x", $0) }.joined(),
                       "34614074e543bf51ca923606279673efaf8b628f80b513b96cb51c923ed574b0")
    }

    func testRequestsCannotEscapeTheBundleOrWriteFiles() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let root = directory.appendingPathComponent("web", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let index = Data("<!doctype html><title>Local asset fixture</title>".utf8)
        try index.write(to: root.appendingPathComponent("index.html"))
        let secret = Data("outside the served directory".utf8)
        let outside = directory.appendingPathComponent("outside.txt")
        try secret.write(to: outside)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("escape.txt"), withDestinationURL: outside)
        let server = try LocalAssetServer(rootURL: root)
        defer { server.stop() }
        let baseURL = try await start(server)
        let port = try XCTUnwrap(baseURL.port)

        // Send exact request targets over TCP: URLSession may normalize dot paths
        // before a request reaches the server and would weaken this regression test.
        for target in ["/../outside.txt", "/%2e%2e/outside.txt", "/%2E%2E%2Foutside.txt", "/escape.txt", "/a%5c..%5coutside.txt"] {
            let response = try await RawHTTPExchange.request(port: port, text:
                "GET \(target) HTTP/1.1\r\nHost: localhost:\(port)\r\n\r\n")
            XCTAssertEqual(response.status, 404, target)
            XCTAssertFalse(response.body == secret, target)
        }
        let foreignHost = try await RawHTTPExchange.request(port: port, text:
            "GET / HTTP/1.1\r\nHost: attacker.example:\(port)\r\n\r\n")
        XCTAssertEqual(foreignHost.status, 403)
        let post = try await RawHTTPExchange.request(port: port, text:
            "POST /index.html HTTP/1.1\r\nHost: localhost:\(port)\r\nContent-Length: 4\r\n\r\nover")
        XCTAssertEqual(post.status, 405)
        XCTAssertEqual(post.headers["allow"], "GET, HEAD")
        let head = try await RawHTTPExchange.request(port: port, text:
            "HEAD / HTTP/1.1\r\nHost: localhost:\(port)\r\n\r\n")
        XCTAssertEqual(head.status, 200)
        XCTAssertEqual(head.headers["content-length"], String(index.count))
        XCTAssertTrue(head.body.isEmpty)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("index.html")), index)
        XCTAssertEqual(try Data(contentsOf: outside), secret)
    }

    private func start(_ server: LocalAssetServer) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            server.start { continuation.resume(with: $0) }
        }
    }
}

/// A bounded HTTP client that preserves deliberately invalid request targets.
private final class RawHTTPExchange {
    struct Response {
        let status: Int
        let headers: [String: String]
        let body: Data
    }

    private let connection: NWConnection
    private let queue = DispatchQueue(label: "PocketSlicerTests.RawHTTP")
    private var continuation: CheckedContinuation<Response, Error>?
    private var received = Data()
    private var deadline: DispatchWorkItem?

    private init(port: UInt16) {
        connection = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!, using: .tcp)
    }

    static func request(port: Int, text: String) async throws -> Response {
        let client = RawHTTPExchange(port: UInt16(port))
        return try await withCheckedThrowingContinuation { continuation in
            client.start(text: text, continuation: continuation)
        }
    }

    private func start(text: String, continuation: CheckedContinuation<Response, Error>) {
        self.continuation = continuation
        // The state handler retains this exchange until finish() clears it.
        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                self.connection.send(content: Data(text.utf8), completion: .contentProcessed { error in
                    if let error { self.finish(.failure(error)) }
                    else { self.receive() }
                })
            case .failed(let error): self.finish(.failure(error))
            default: break
            }
        }
        let timeout = DispatchWorkItem { [weak self] in
            self?.finish(.failure(NSError(domain: "PocketSlicerHTTPTest", code: 1,
                                          userInfo: [NSLocalizedDescriptionKey: "Loopback HTTP response timed out."])))
        }
        deadline = timeout
        queue.asyncAfter(deadline: .now() + 15, execute: timeout)
        connection.start(queue: queue)
    }

    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { data, _, complete, error in
            guard self.continuation != nil else { return }
            if let data { self.received.append(data) }
            if let error { self.finish(.failure(error)); return }
            if complete {
                do { self.finish(.success(try self.parseResponse())) }
                catch { self.finish(.failure(error)) }
            } else if self.received.count > 1_048_576 {
                self.finish(.failure(NSError(domain: "PocketSlicerHTTPTest", code: 2)))
            } else { self.receive() }
        }
    }

    private func parseResponse() throws -> Response {
        guard let split = received.range(of: Data("\r\n\r\n".utf8)),
              let header = String(data: received[..<split.lowerBound], encoding: .utf8) else {
            throw NSError(domain: "PocketSlicerHTTPTest", code: 3)
        }
        let lines = header.components(separatedBy: "\r\n")
        let statusLine = (lines.first ?? "").split(separator: " ")
        guard statusLine.count >= 2, let status = Int(statusLine[1]) else {
            throw NSError(domain: "PocketSlicerHTTPTest", code: 4)
        }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            headers[line[..<colon].lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        return Response(status: status, headers: headers, body: Data(received[split.upperBound...]))
    }

    private func finish(_ result: Result<Response, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        deadline?.cancel()
        deadline = nil
        connection.stateUpdateHandler = nil
        connection.cancel()
        continuation.resume(with: result)
    }
}
