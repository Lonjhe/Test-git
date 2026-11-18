import Foundation
import Combine

/// Adresse du serveur Séance, conservée sur l'appareil.
@MainActor
final class ServerStore: ObservableObject {
    private static let key = "seance.server"

    @Published private(set) var url: URL?

    init() {
        if let saved = UserDefaults.standard.string(forKey: Self.key) {
            url = URL(string: saved)
        }
    }

    /// Transforme une saisie (« 192.168.1.20:8080 », « http://mac.local:8080/ »)
    /// en adresse de base du serveur.
    static func normalize(_ input: String) -> URL? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        let lower = text.lowercased()
        if !lower.hasPrefix("http://") && !lower.hasPrefix("https://") {
            text = "http://" + text
        }
        guard var parts = URLComponents(string: text), let host = parts.host, !host.isEmpty else { return nil }
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        // Sans port précisé, on suppose celui par défaut de Séance.
        if parts.port == nil && parts.scheme == "http" { parts.port = 8080 }
        return parts.url
    }

    /// Vérifie que l'adresse est bien celle d'un serveur Séance, puis la mémorise.
    func connect(_ input: String) async throws {
        guard let candidate = Self.normalize(input) else { throw ServerError.invalidAddress }
        var request = URLRequest(url: candidate.appendingPathComponent("api/status"))
        request.timeoutInterval = 8
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw ServerError.unreachable
        }
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["catalog"] != nil
        else { throw ServerError.notSeance }
        UserDefaults.standard.set(candidate.absoluteString, forKey: Self.key)
        url = candidate
    }

    /// Oublie le serveur : l'écran de connexion réapparaît.
    func forget() {
        UserDefaults.standard.removeObject(forKey: Self.key)
        url = nil
    }
}

enum ServerError: LocalizedError {
    case invalidAddress, unreachable, notSeance

    var errorDescription: String? {
        switch self {
        case .invalidAddress:
            return "Cette adresse n'est pas valide. Exemple : 192.168.1.20:8080"
        case .unreachable:
            return "Le serveur ne répond pas. Vérifiez que Séance tourne sur votre ordinateur (npm start) et que cet appareil est sur le même réseau Wi-Fi."
        case .notSeance:
            return "Cette adresse répond, mais ce n'est pas un serveur Séance."
        }
    }
}
