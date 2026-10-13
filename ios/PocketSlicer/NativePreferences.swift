import Foundation
import WebKit

/// Keeps the two non-secret web preferences across ephemeral loopback origins.
/// Models, G-code, API keys, and arbitrary localStorage keys are never persisted.
@MainActor
final class NativePreferences: NSObject, WKScriptMessageHandler {
    static let handlerName = "nativePreferences"
    static let allowedKeys = ["pocket-settings-v1", "pocket-printer-v1"]
    private let allowedOrigin: URL
    private let defaults: UserDefaults
    private static let prefix = "PocketSlicer.webPreference."

    init(allowedOrigin: URL, defaults: UserDefaults = .standard) {
        self.allowedOrigin = allowedOrigin
        self.defaults = defaults
        super.init()
    }

    var restoredValues: [String: String] {
        var values: [String: String] = [:]
        for key in Self.allowedKeys {
            let storageKey = Self.prefix + key
            if let value = defaults.string(forKey: storageKey), validValue(value, for: key) {
                values[key] = value
            } else {
                defaults.removeObject(forKey: storageKey)
            }
        }
        return values
    }

    /// Injected before the app's first script reads localStorage.
    var injectionScript: String {
        let payload: [String: Any] = ["origin": allowedOrigin.absoluteString, "values": restoredValues]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
              let json = String(data: data, encoding: .utf8) else { return "" }
        return """
        (() => {
          const config = \(json);
          if (location.origin !== new URL(config.origin).origin) return;
          const allowed = new Set(['pocket-settings-v1', 'pocket-printer-v1']);
          const set = Storage.prototype.setItem;
          const remove = Storage.prototype.removeItem;
          const clear = Storage.prototype.clear;
          let local;
          try {
            local = window.localStorage;
            // Reloads keep the current session's edits; a new WKWebView restores
            // a fresh snapshot from UserDefaults through a new configuration.
            const marker = 'pocket-native-preferences-hydrated';
            if (sessionStorage.getItem(marker) !== '1') {
              for (const key of allowed) {
                if (Object.prototype.hasOwnProperty.call(config.values, key)) set.call(local, key, config.values[key]);
                else remove.call(local, key);
              }
              sessionStorage.setItem(marker, '1');
            }
          } catch { return; }
          const send = (operation, key, value) => {
            try { window.webkit.messageHandlers.nativePreferences.postMessage({version: 1, operation, key, value}); } catch {}
          };
          Storage.prototype.setItem = function(key, value) {
            const name = String(key), text = String(value);
            set.call(this, name, text);
            if (this === local && allowed.has(name)) send('set', name, text);
          };
          Storage.prototype.removeItem = function(key) {
            const name = String(key);
            remove.call(this, name);
            if (this === local && allowed.has(name)) send('remove', name, null);
          };
          Storage.prototype.clear = function() {
            clear.call(this);
            if (this === local) for (const key of allowed) send('remove', key, null);
          };
        })();
        """
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.handlerName, message.frameInfo.isMainFrame,
              allowedOrigin.scheme == "http", allowedOrigin.host == "localhost", let port = allowedOrigin.port,
              message.frameInfo.securityOrigin.protocol == "http",
              message.frameInfo.securityOrigin.host.lowercased() == "localhost",
              message.frameInfo.securityOrigin.port == port,
              let page = message.webView?.url, page.scheme == "http", page.host == "localhost", page.port == port,
              page.user == nil, page.password == nil,
              let body = message.body as? [String: Any], body["version"] as? Int == 1,
              let operation = body["operation"] as? String, let key = body["key"] as? String else { return }
        _ = store(operation: operation, key: key, value: body["value"] as? String)
    }

    /// The message handler validates origin before reaching this bounded store.
    @discardableResult
    func store(operation: String, key: String, value: String?) -> Bool {
        guard Self.allowedKeys.contains(key) else { return false }
        switch operation {
        case "set":
            guard let value = value, validValue(value, for: key) else { return false }
            defaults.set(value, forKey: Self.prefix + key)
        case "remove":
            defaults.removeObject(forKey: Self.prefix + key)
        default: return false
        }
        return true
    }

    private func validValue(_ value: String, for key: String) -> Bool {
        if key == "pocket-printer-v1" {
            // Credentials and URL query tokens do not belong in a saved printer address.
            return value.utf8.count <= 2_048 && value.rangeOfCharacter(from: .controlCharacters) == nil
                && !value.contains("@") && !value.contains("?") && !value.contains("#")
        }
        guard key == "pocket-settings-v1", value.utf8.count <= 16_384,
              let data = value.data(using: .utf8),
              let settings = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return false }
        let choices: [String: Set<String>] = [
            "material": ["PLA", "PETG", "ABS"], "quality": ["fine", "standard", "draft"],
            "nozzle": ["0.4", "0.6", "0.8"], "support": ["off", "normal", "tree"],
            "bedType": ["Textured PEI Plate", "High Temp Plate", "Engineering Plate"],
            "infillPattern": ["grid", "gyroid", "rectilinear", "cubic"]
        ]
        let numeric: Set<String> = ["infill", "walls", "brim", "nozzleTemperature", "bedTemperature", "layerHeight"]
        for (field, setting) in settings {
            if let allowed = choices[field] {
                guard let choice = setting as? String, allowed.contains(choice) else { return false }
            } else if numeric.contains(field) {
                guard setting is NSNull || (setting as? NSNumber)?.doubleValue.isFinite == true else { return false }
            } else { return false }
        }
        return true
    }
}
