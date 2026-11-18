import Foundation
import Combine

enum SortOrder: String, CaseIterable {
    case recent = "Récents"
    case rating = "Mieux notés"
    case year = "Année"
    case title = "A – Z"
}

/// Le catalogue, les favoris et les lectures en cours, partagés par tous les écrans.
@MainActor
final class Library: ObservableObject {
    enum Phase {
        case loading
        case ready
        case empty
        case failed(String)
    }

    let api: API

    @Published var phase: Phase = .loading
    @Published private(set) var movies: [Movie] = []
    @Published private(set) var series: [Series] = []
    @Published private(set) var channels: [Channel] = []
    @Published private(set) var favorites: [String: Double] = [:]
    @Published private(set) var progress: [String: Progress] = [:]
    @Published private(set) var shelves: [Shelf] = []
    @Published private(set) var version = 0
    @Published var playing: PlayRequest?

    private var moviesByID: [String: Movie] = [:]
    private var seriesByID: [String: Series] = [:]

    init(api: API) {
        self.api = api
    }

    // MARK: Chargement

    func load() async {
        phase = .loading
        do {
            var status: StatusResponse = try await api.get("/api/status")
            guard status.configured else {
                phase = .empty
                return
            }
            // Premier lancement chez un gros fournisseur : le serveur charge encore le catalogue.
            var waits = 0
            while status.catalog.loading, waits < 180,
                  status.catalog.counts.movies + status.catalog.counts.series + status.catalog.counts.channels == 0 {
                try await Task.sleep(nanoseconds: 1_000_000_000)
                status = try await api.get("/api/status")
                waits += 1
            }
            async let catalog: CatalogResponse = api.get("/api/catalog")
            async let state: UserState = api.get("/api/state")
            let (loaded, user) = try await (catalog, state)
            movies = loaded.movies
            series = loaded.series
            channels = loaded.channels
            favorites = user.favorites
            progress = user.progress
            moviesByID = [:]
            for movie in movies {
                moviesByID[movie.id] = movie
                for version in movie.versions ?? [] { moviesByID[version.id] = movie }
            }
            seriesByID = [:]
            for show in series { seriesByID[show.id] = show }
            version += 1
            rebuildShelves()
            phase = (movies.isEmpty && series.isEmpty && channels.isEmpty) ? .empty : .ready
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    // MARK: Favoris et progression

    func isFavorite(_ id: String) -> Bool {
        favorites[id] != nil
    }

    func toggleFavorite(_ id: String) {
        let on = !isFavorite(id)
        if on {
            favorites[id] = Date().timeIntervalSince1970 * 1000
        } else {
            favorites[id] = nil
        }
        Task { await api.post("/api/state/favorite", ["id": id, "on": on]) }
        rebuildShelves()
    }

    func saveProgress(key: String, position: Double, duration: Double, done: Bool, request: PlayRequest) {
        var entry = Progress()
        entry.pos = position
        entry.dur = duration
        entry.ts = Date().timeIntervalSince1970 * 1000
        entry.done = done
        entry.kind = request.kind
        entry.title = request.title
        entry.sub = request.sub
        entry.poster = request.poster
        entry.parent = request.parent
        entry.play = request.id
        progress[key] = entry
        Task {
            await api.post("/api/state/progress", [
                "id": key, "pos": Int(position), "dur": Int(duration), "done": done,
                "kind": request.kind, "title": request.title, "sub": request.sub,
                "poster": request.poster, "parent": request.parent, "play": request.id,
            ])
        }
    }

    func clearProgress(_ key: String) {
        progress[key] = nil
        Task { await api.post("/api/state/progress", ["id": key, "remove": true]) }
        rebuildShelves()
    }

    /// Part vue (0 à 1) d'un film ou d'un épisode.
    func watchedFraction(_ key: String) -> Double {
        guard let entry = progress[key] else { return 0 }
        if entry.done == true { return 1 }
        guard let dur = entry.dur, dur > 0 else { return 0 }
        return min(1, (entry.pos ?? 0) / dur)
    }

    // MARK: Lectures

    func movieRequest(_ movie: Movie, version: String? = nil, fromStart: Bool = false) -> PlayRequest {
        let entry = progress[movie.id]
        let streamID = version ?? entry?.play ?? movie.id
        let label = movie.versions?.first { $0.id == streamID }?.label ?? ""
        let resume = !fromStart && entry?.done != true && (entry?.pos ?? 0) > 20
        return PlayRequest(id: streamID, key: movie.id, kind: "movie", title: movie.title, sub: label,
                           poster: movie.poster ?? "", parent: "", queue: [],
                           startAt: resume ? (entry?.pos ?? 0) : 0)
    }

    func episodeRequest(_ show: Series, episodes: [Episode], index: Int, fromStart: Bool = false) -> PlayRequest {
        func label(_ e: Episode) -> String {
            "S\(e.season) · É\(e.episode)" + ((e.title ?? "").isEmpty ? "" : " — \(e.title ?? "")")
        }
        let current = episodes[index]
        let entry = progress[current.id]
        let resume = !fromStart && entry?.done != true && (entry?.pos ?? 0) > 20
        let queue = episodes.dropFirst(index + 1).map {
            QueueItem(id: $0.id, sub: label($0), poster: $0.image ?? show.backdrop ?? show.poster ?? "")
        }
        return PlayRequest(id: current.id, key: current.id, kind: "episode", title: show.title, sub: label(current),
                           poster: current.image ?? show.backdrop ?? show.poster ?? "", parent: show.id,
                           queue: queue, startAt: resume ? (entry?.pos ?? 0) : 0)
    }

    func channelRequest(_ channel: Channel) -> PlayRequest {
        PlayRequest(id: channel.id, key: channel.id, kind: "channel", title: channel.name, sub: channel.cat ?? "",
                    poster: channel.logo ?? "", parent: "", queue: [], startAt: 0)
    }

    // MARK: Affiches

    func moviePoster(_ movie: Movie) -> Poster {
        var parts: [String] = []
        if let year = movie.year, year > 0 { parts.append(String(year)) }
        if let rating = movie.rating, rating > 0 { parts.append("★ " + String(format: "%.1f", rating)) }
        return Poster(id: movie.id, title: movie.title, subtitle: parts.joined(separator: " · "), image: movie.poster,
                      progress: watchedFraction(movie.id), action: .open(.movie(movie)))
    }

    func seriesPoster(_ show: Series) -> Poster {
        var parts: [String] = []
        if let year = show.year, year > 0 { parts.append(String(year)) }
        if let rating = show.rating, rating > 0 { parts.append("★ " + String(format: "%.1f", rating)) }
        return Poster(id: show.id, title: show.title, subtitle: parts.joined(separator: " · "), image: show.poster,
                      action: .open(.series(show)))
    }

    func channelPoster(_ channel: Channel) -> Poster {
        Poster(id: channel.id, title: channel.name, image: channel.logo, wide: true, fit: true,
               action: .play(channelRequest(channel)))
    }

    // MARK: Listes

    func posters(kind: CatalogKind, genre: String?, sort: SortOrder) -> [Poster] {
        switch kind {
        case .movies:
            var list = movies.filter { genre == nil || $0.genreList.contains(genre ?? "") }
            switch sort {
            case .recent: list.sort { ($0.added ?? 0) > ($1.added ?? 0) }
            case .rating: list.sort { ($0.rating ?? 0) > ($1.rating ?? 0) }
            case .year: list.sort { ($0.year ?? 0) > ($1.year ?? 0) }
            case .title: list.sort { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
            }
            return list.map(moviePoster)
        case .series:
            var list = series.filter { genre == nil || $0.genreList.contains(genre ?? "") }
            switch sort {
            case .recent: list.sort { ($0.added ?? 0) > ($1.added ?? 0) }
            case .rating: list.sort { ($0.rating ?? 0) > ($1.rating ?? 0) }
            case .year: list.sort { ($0.year ?? 0) > ($1.year ?? 0) }
            case .title: list.sort { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
            }
            return list.map(seriesPoster)
        }
    }

    func genres(for kind: CatalogKind) -> [String] {
        var counts: [String: Int] = [:]
        switch kind {
        case .movies: for movie in movies { for g in movie.genreList { counts[g, default: 0] += 1 } }
        case .series: for show in series { for g in show.genreList { counts[g, default: 0] += 1 } }
        }
        return counts.sorted { $0.value > $1.value }.map { $0.key }
    }

    /// Films proches d'un film donné : genres communs, même époque, bien notés.
    func similar(to movie: Movie, limit: Int = 20) -> [Movie] {
        let mine = Set(movie.genreList)
        guard !mine.isEmpty else { return [] }
        var scored: [(Movie, Double)] = []
        for other in movies where other.id != movie.id {
            let theirs = Set(other.genreList)
            let shared = theirs.intersection(mine).count
            if shared == 0 { continue }
            var score = Double(shared) / Double(theirs.union(mine).count) * 5
            if let a = movie.year, let b = other.year, a > 0, b > 0 {
                score += 1.5 * exp(-Double(abs(a - b)) / 10)
            }
            score += 0.15 * (other.rating ?? 5)
            scored.append((other, score))
        }
        scored.sort { $0.1 > $1.1 }
        return scored.prefix(limit).map { $0.0 }
    }

    func channelCategories() -> [String] {
        var seen = Set<String>()
        var ordered: [String] = []
        for channel in channels {
            let cat = channel.cat ?? "Autres"
            if seen.insert(cat).inserted { ordered.append(cat) }
        }
        return ordered
    }

    // MARK: Étagères de l'accueil

    func refreshShelves() {
        rebuildShelves()
    }

    private func continueWatching() -> [Poster] {
        let entries = progress
            .filter { $0.value.done != true && ($0.value.pos ?? 0) >= 20 }
            .sorted { ($0.value.ts ?? 0) > ($1.value.ts ?? 0) }
        var seen = Set<String>()
        var out: [Poster] = []
        for (key, entry) in entries {
            let group = (entry.parent ?? "").isEmpty ? key : (entry.parent ?? key)
            if !seen.insert(group).inserted { continue }
            let kind = entry.kind ?? "movie"
            if kind == "movie" && moviesByID[key] == nil { continue }
            let request = PlayRequest(id: entry.play ?? key, key: key, kind: kind, title: entry.title ?? "",
                                      sub: entry.sub ?? "", poster: entry.poster ?? "", parent: entry.parent ?? "",
                                      queue: [], startAt: entry.pos ?? 0)
            let image = moviesByID[key]?.backdrop ?? entry.poster
            let fraction = (entry.dur ?? 0) > 0 ? (entry.pos ?? 0) / (entry.dur ?? 1) : 0
            out.append(Poster(id: "resume-" + key, title: entry.title ?? "Lecture", subtitle: entry.sub ?? "",
                              image: image, wide: true, progress: fraction, action: .play(request)))
            if out.count >= 20 { break }
        }
        return out
    }

    private func rebuildShelves() {
        var out: [Shelf] = []

        let resume = continueWatching()
        if !resume.isEmpty { out.append(Shelf(id: "resume", title: "Reprendre la lecture", items: resume)) }

        let mine: [Poster] = favorites.sorted { $0.value > $1.value }.compactMap { entry in
            if let movie = moviesByID[entry.key] { return moviePoster(movie) }
            if let show = seriesByID[entry.key] { return seriesPoster(show) }
            return nil
        }
        if !mine.isEmpty { out.append(Shelf(id: "mine", title: "Ma liste", items: mine)) }

        let recent = movies.filter { ($0.added ?? 0) > 0 }.sorted { ($0.added ?? 0) > ($1.added ?? 0) }.prefix(30)
        if !recent.isEmpty { out.append(Shelf(id: "recent", title: "Ajouts récents", items: recent.map(moviePoster))) }

        let top = movies.filter { ($0.rating ?? 0) > 0 }.sorted { ($0.rating ?? 0) > ($1.rating ?? 0) }.prefix(30)
        if !top.isEmpty { out.append(Shelf(id: "top", title: "Les mieux notés", items: top.map(moviePoster))) }

        if !series.isEmpty {
            let list = series.sorted { ($0.added ?? 0) > ($1.added ?? 0) }.prefix(30)
            out.append(Shelf(id: "series", title: "Séries", items: list.map(seriesPoster)))
        }

        for genre in genres(for: .movies).prefix(8) {
            let list = movies.filter { $0.genreList.contains(genre) }
            if list.count < 4 { continue }
            let best = list.sorted { ($0.rating ?? 0) > ($1.rating ?? 0) }.prefix(30)
            out.append(Shelf(id: "genre-" + genre, title: genre, items: best.map(moviePoster)))
        }

        if !channels.isEmpty {
            out.append(Shelf(id: "live", title: "TV en direct", items: channels.prefix(30).map(channelPoster)))
        }
        shelves = out
    }
}

enum CatalogKind {
    case movies, series
}
