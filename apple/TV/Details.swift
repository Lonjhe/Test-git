import SwiftUI

private func minutesText(_ minutes: Int?) -> String {
    guard let minutes, minutes > 0 else { return "" }
    let h = minutes / 60
    let m = minutes % 60
    return h > 0 ? "\(h) h \(String(format: "%02d", m))" : "\(m) min"
}

/// Fond de fiche : grande image assombrie.
private struct Backdrop: View {
    let path: String?
    let title: String

    var body: some View {
        RemoteImage(path: path, title: "")
            .overlay(Color.black.opacity(0.62))
            .overlay(LinearGradient(colors: [.clear, .black], startPoint: .center, endPoint: .bottom))
            .ignoresSafeArea()
    }
}

struct MovieDetailView: View {
    let movie: Movie
    @EnvironmentObject private var library: Library
    @State private var detail: MovieDetail?
    @State private var version: String?
    @State private var similar: [Poster] = []

    private var entry: Progress? { library.progress[movie.id] }
    private var inProgress: Bool { entry?.done != true && (entry?.pos ?? 0) > 20 }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 18) {
                    Text(movie.title).font(.largeTitle.bold())
                    Text(meta).foregroundStyle(.secondary)
                    if let plot = detail?.plot, !plot.isEmpty {
                        Text(plot).lineLimit(6).frame(maxWidth: 1100, alignment: .leading)
                    }
                    if let director = detail?.director, !director.isEmpty {
                        Text("Réalisation : \(director)").font(.callout).foregroundStyle(.secondary)
                    }
                    if let cast = detail?.cast, !cast.isEmpty {
                        Text("Avec : " + cast.prefix(6).joined(separator: ", ")).font(.callout).foregroundStyle(.secondary)
                    }
                }
                .padding(.top, 60)

                HStack(spacing: 30) {
                    Button {
                        library.playing = library.movieRequest(movie, version: version)
                    } label: {
                        Label(inProgress ? "Reprendre" : "Lecture", systemImage: "play.fill")
                    }
                    if inProgress {
                        Button("Recommencer") {
                            library.playing = library.movieRequest(movie, version: version, fromStart: true)
                        }
                    }
                    Button {
                        library.toggleFavorite(movie.id)
                    } label: {
                        Label(library.isFavorite(movie.id) ? "Dans ma liste" : "Ma liste",
                              systemImage: library.isFavorite(movie.id) ? "checkmark" : "plus")
                    }
                }

                if let versions = movie.versions, versions.count > 1 {
                    HStack(spacing: 20) {
                        Text("Version").foregroundStyle(.secondary)
                        ForEach(versions, id: \.id) { v in
                            Button(((version ?? versions[0].id) == v.id ? "✓ " : "") + v.label) { version = v.id }
                        }
                    }
                }

                if !similar.isEmpty {
                    ShelfView(shelf: Shelf(id: "similar", title: "Dans le même style", items: similar))
                        .padding(.horizontal, -80)
                }
            }
            .padding(.horizontal, 80)
            .padding(.bottom, 60)
        }
        .background(Backdrop(path: detail?.backdrop ?? movie.backdrop ?? movie.poster, title: movie.title))
        .task {
            similar = library.similar(to: movie).map { library.moviePoster($0) }
            detail = try? await library.api.get("/api/movie/" + enc(movie.id))
        }
    }

    private var meta: String {
        var parts: [String] = []
        if let year = movie.year, year > 0 { parts.append(String(year)) }
        let length = minutesText(detail?.duration)
        if !length.isEmpty { parts.append(length) }
        if let rating = movie.rating, rating > 0 { parts.append("★ " + String(format: "%.1f", rating)) }
        parts.append(contentsOf: (detail?.genres ?? movie.genreList).prefix(3))
        return parts.joined(separator: " · ")
    }
}

struct SeriesDetailView: View {
    let show: Series
    @EnvironmentObject private var library: Library
    @State private var detail: SeriesDetail?
    @State private var failure: String?
    @State private var season = 1

    private var episodes: [Episode] { detail?.episodes ?? [] }
    private var seasons: [Int] { Array(Set(episodes.map { $0.season })).sorted() }

    private var hasStarted: Bool {
        episodes.contains { library.progress[$0.id] != nil }
    }

    /// Dernier épisode entamé (ou celui qui suit un épisode terminé), sinon le premier.
    private func resumeIndex(in list: [Episode]) -> Int {
        var best: Int?
        var bestTime = -1.0
        for index in list.indices {
            guard let entry = library.progress[list[index].id] else { continue }
            let time = entry.ts ?? 0
            if time > bestTime {
                bestTime = time
                best = index
            }
        }
        guard let started = best else { return 0 }
        if library.progress[list[started].id]?.done == true, started + 1 < list.count {
            return started + 1
        }
        return started
    }

    private var meta: String {
        var parts: [String] = []
        if let year = show.year, year > 0 { parts.append(String(year)) }
        parts.append(contentsOf: show.genreList.prefix(3))
        return parts.joined(separator: " · ")
    }

    private var visibleIndices: [Int] {
        episodes.indices.filter { episodes[$0].season == season }
    }

    private func title(of episode: Episode) -> String {
        let name = episode.title ?? ""
        return "\(episode.episode). " + (name.isEmpty ? "Épisode \(episode.episode)" : name)
    }

    private func subtitle(of episode: Episode) -> String {
        var parts: [String] = []
        let length = minutesText(episode.duration)
        if !length.isEmpty { parts.append(length) }
        if library.watchedFraction(episode.id) >= 1 { parts.append("Vu") }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 18) {
                    Text(show.title).font(.largeTitle.bold())
                    Text(meta).foregroundStyle(.secondary)
                    if let plot = detail?.plot ?? show.plot, !plot.isEmpty {
                        Text(plot).lineLimit(5).frame(maxWidth: 1100, alignment: .leading)
                    }
                }
                .padding(.top, 60)

                HStack(spacing: 30) {
                    if !episodes.isEmpty {
                        Button {
                            library.playing = library.episodeRequest(show, episodes: episodes, index: resumeIndex(in: episodes))
                        } label: {
                            Label(hasStarted ? "Reprendre" : "Lecture", systemImage: "play.fill")
                        }
                    }
                    Button {
                        library.toggleFavorite(show.id)
                    } label: {
                        Label(library.isFavorite(show.id) ? "Dans ma liste" : "Ma liste",
                              systemImage: library.isFavorite(show.id) ? "checkmark" : "plus")
                    }
                }

                if let failure {
                    Text(failure).foregroundStyle(.red)
                } else if detail == nil {
                    ProgressView("Chargement des épisodes…")
                }

                if seasons.count > 1 {
                    HStack(spacing: 20) {
                        ForEach(seasons, id: \.self) { s in
                            Button((season == s ? "✓ " : "") + "Saison \(s)") { season = s }
                        }
                    }
                }

                ForEach(visibleIndices, id: \.self) { index in
                    episodeRow(index)
                }
            }
            .padding(.horizontal, 80)
            .padding(.bottom, 60)
        }
        .background(Backdrop(path: detail?.backdrop ?? show.backdrop ?? show.poster, title: show.title))
        .task {
            do {
                let loaded: SeriesDetail = try await library.api.get("/api/series/" + enc(show.id))
                detail = loaded
                if !loaded.episodes.isEmpty {
                    season = loaded.episodes[resumeIndex(in: loaded.episodes)].season
                }
            } catch {
                failure = error.localizedDescription
            }
        }
    }

    private func episodeRow(_ index: Int) -> some View {
        let episode = episodes[index]
        return Button {
            library.playing = library.episodeRequest(show, episodes: episodes, index: index)
        } label: {
            HStack(alignment: .top, spacing: 24) {
                RemoteImage(path: episode.image ?? show.backdrop, title: "É\(episode.episode)")
                    .frame(width: 280, height: 158)
                    .clipped()
                VStack(alignment: .leading, spacing: 8) {
                    Text(title(of: episode)).font(.headline)
                    Text(subtitle(of: episode)).font(.caption).foregroundStyle(.secondary)
                    if let plot = episode.plot, !plot.isEmpty {
                        Text(plot).font(.caption).lineLimit(3).foregroundStyle(.secondary)
                    }
                }
                Spacer()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.card)
    }
}
