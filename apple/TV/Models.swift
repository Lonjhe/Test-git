import Foundation

// Formats échangés avec le serveur Séance (voir server/index.js et test/apple-contract.test.js).
// Tout ce qui peut manquer est optionnel : un champ absent ne doit jamais faire échouer le catalogue.

struct Movie: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    var year: Int?
    var poster: String?
    var backdrop: String?
    var rating: Double?
    var added: Int?
    var cat: String?
    var genres: [String]?
    var quality: String?
    var versions: [Version]?

    struct Version: Codable, Hashable {
        let id: String
        let label: String
        var quality: String?
    }

    var genreList: [String] { genres ?? [] }
}

struct Series: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    var year: Int?
    var poster: String?
    var backdrop: String?
    var rating: Double?
    var added: Int?
    var cat: String?
    var genres: [String]?
    var plot: String?

    var genreList: [String] { genres ?? [] }
}

struct Channel: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    var logo: String?
    var cat: String?
    var num: Int?
}

struct CatalogResponse: Decodable {
    let movies: [Movie]
    let series: [Series]
    let channels: [Channel]
}

struct StatusResponse: Decodable {
    let configured: Bool
    let catalog: CatalogStatus

    struct CatalogStatus: Decodable {
        let loading: Bool
        let counts: Counts
    }

    struct Counts: Decodable {
        let movies: Int
        let series: Int
        let channels: Int
    }
}

struct MovieDetail: Decodable {
    var plot: String?
    var tagline: String?
    var duration: Int?
    var cast: [String]?
    var director: String?
    var genres: [String]?
    var backdrop: String?
}

struct Episode: Codable, Identifiable, Hashable {
    let id: String
    let season: Int
    let episode: Int
    var title: String?
    var plot: String?
    var duration: Int?
    var image: String?
}

struct SeriesDetail: Decodable {
    var plot: String?
    var backdrop: String?
    let episodes: [Episode]
}

struct PlayInfo: Decodable {
    let url: String
    let type: String
    var ext: String?
    var external: String?
    var convert: String?
    var convertHls: String?
    var ffmpeg: Bool?
    var alt: Alt?

    struct Alt: Decodable {
        let url: String
        let type: String
    }
}

struct ProbeResponse: Decodable {
    let duration: Int
}

struct Progress: Codable, Hashable {
    var pos: Double?
    var dur: Double?
    var ts: Double?
    var done: Bool?
    var kind: String?
    var title: String?
    var sub: String?
    var poster: String?
    var parent: String?
    var play: String?
}

struct UserState: Decodable {
    var favorites: [String: Double]
    var progress: [String: Progress]
}

// MARK: - Éléments d'interface

/// Destination ouverte depuis une affiche.
enum Route: Hashable {
    case movie(Movie)
    case series(Series)
}

/// Un épisode à enchaîner après celui en cours.
struct QueueItem: Hashable {
    let id: String
    let sub: String
    let poster: String
}

/// Tout ce qu'il faut pour lancer une lecture.
struct PlayRequest: Identifiable, Hashable {
    var id: String          // identifiant du flux (version du film, épisode ou chaîne)
    var key: String         // identifiant sous lequel la progression est enregistrée
    var kind: String        // "movie", "episode" ou "channel"
    var title: String
    var sub: String
    var poster: String
    var parent: String
    var queue: [QueueItem]
    var startAt: Double
}

struct Poster: Identifiable, Hashable {
    enum Action: Hashable {
        case open(Route)
        case play(PlayRequest)
    }

    let id: String
    let title: String
    var subtitle: String = ""
    var image: String?
    var wide: Bool = false
    var fit: Bool = false
    var progress: Double = 0
    let action: Action
}

struct Shelf: Identifiable {
    let id: String
    let title: String
    let items: [Poster]
}
