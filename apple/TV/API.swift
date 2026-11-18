import Foundation

/// Encode un identifiant pour l'utiliser dans une adresse.
func enc(_ text: String) -> String {
    text.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? text
}

struct APIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Client de l'API du serveur Séance.
struct API {
    let base: URL

    /// Adresse complète d'une route du serveur (« /api/catalog », « /convert-hls/… »).
    func url(_ path: String) -> URL {
        URL(string: path, relativeTo: base)?.absoluteURL ?? base
    }

    /// Adresse d'une image : absolue (fournisseur, TMDB) ou relative au serveur.
    func imageURL(_ path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http://") || path.hasPrefix("https://") { return URL(string: path) }
        return URL(string: path, relativeTo: base)?.absoluteURL
    }

    func get<T: Decodable>(_ path: String) async throws -> T {
        var request = URLRequest(url: url(path))
        request.timeoutInterval = 90
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
            let detail = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError(message: detail ?? "Le serveur a répondu \(http.statusCode).")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// Envoi sans attente de réponse (favoris, progression) : un échec n'interrompt jamais la lecture.
    func post(_ path: String, _ body: [String: Any]) async {
        var request = URLRequest(url: url(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        _ = try? await URLSession.shared.data(for: request)
    }
}
