import Foundation
import XCTest
@testable import PocketSlicer

final class NativePreferencesTests: XCTestCase {
    @MainActor
    func testAllowedPreferencesSurviveAnOriginPortChangeAndCanBeRemoved() throws {
        let suite = "PocketSlicerTests." + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let original = NativePreferences(allowedOrigin: URL(string: "http://localhost:49152/")!, defaults: defaults)
        let settings = #"{"material":"PETG","quality":"fine","nozzle":"0.6","infill":20,"walls":3,"layerHeight":null}"#
        XCTAssertTrue(original.store(operation: "set", key: "pocket-settings-v1", value: settings))
        XCTAssertTrue(original.store(operation: "set", key: "pocket-printer-v1", value: "http://192.168.1.120"))
        let reopened = NativePreferences(allowedOrigin: URL(string: "http://localhost:49153/")!, defaults: defaults)
        XCTAssertEqual(reopened.restoredValues, ["pocket-settings-v1": settings, "pocket-printer-v1": "http://192.168.1.120"])
        XCTAssertTrue(reopened.store(operation: "remove", key: "pocket-settings-v1", value: nil))
        XCTAssertTrue(reopened.store(operation: "remove", key: "pocket-printer-v1", value: nil))
        XCTAssertTrue(original.restoredValues.isEmpty)
    }

    @MainActor
    func testSecretsUnknownKeysAndMalformedValuesAreNotPersisted() throws {
        let suite = "PocketSlicerTests." + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let preferences = NativePreferences(allowedOrigin: URL(string: "http://localhost:49152/")!, defaults: defaults)
        for key in ["apiKey", "pocket-api-key", "model", "gcode", "unrelated"] {
            XCTAssertFalse(preferences.store(operation: "set", key: key, value: "should-not-persist"), key)
        }
        for value in [#"{"apiKey":"secret"}"#, #"{"material":"PLA","token":"secret"}"#,
                      #"{"material":"invalid"}"#, #"{"infill":"secret"}"#, "[]", "not JSON", String(repeating: "x", count: 16_385)] {
            XCTAssertFalse(preferences.store(operation: "set", key: "pocket-settings-v1", value: value))
        }
        for value in ["http://user:secret@192.168.1.120", "http://192.168.1.120?token=secret",
                      "http://192.168.1.120#secret", "192.168.1.120\nsecret", String(repeating: "x", count: 2_049)] {
            XCTAssertFalse(preferences.store(operation: "set", key: "pocket-printer-v1", value: value))
        }
        XCTAssertFalse(preferences.store(operation: "clear-all", key: "pocket-settings-v1", value: nil))
        XCTAssertTrue(preferences.restoredValues.isEmpty)
        XCTAssertTrue(defaults.persistentDomain(forName: suite)?.isEmpty ?? true)
    }
}
