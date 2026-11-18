import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var server: ServerStore

    var body: some View {
        NavigationStack {
            content
                .withDestinations()
        }
    }

    @ViewBuilder
    private var content: some View {
        switch library.phase {
        case .loading:
            ProgressView("Chargement de votre catalogue…")
        case .failed(let message):
            MessageView(title: "Séance est injoignable", text: message,
                        buttonTitle: "Réessayer", action: { Task { await library.load() } })
        case .empty:
            MessageView(title: "Votre catalogue est vide",
                        text: "Ajoutez votre abonnement dans les réglages de Séance, depuis un navigateur ou l'app sur iPhone, iPad ou Mac, puis revenez ici.",
                        buttonTitle: "Actualiser", action: { Task { await library.load() } })
        case .ready:
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 24) {
                    ForEach(library.shelves) { shelf in
                        ShelfView(shelf: shelf)
                    }
                }
                .padding(.vertical, 40)
            }
        }
    }
}

/// Films ou séries : filtre par genre et tri.
struct CatalogView: View {
    let kind: CatalogKind
    @EnvironmentObject private var library: Library
    @State private var genre: String?
    @State private var sort: SortOrder = .recent
    @State private var posters: [Poster] = []

    private let columns = [GridItem(.adaptive(minimum: 230), spacing: 40, alignment: .top)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    chips(title: "Genre", values: library.genres(for: kind), selected: genre) { value in
                        genre = (genre == value) ? nil : value
                    }
                    chips(title: "Trier", values: SortOrder.allCases.map(\.rawValue), selected: sort.rawValue) { value in
                        sort = SortOrder(rawValue: value) ?? .recent
                    }
                    if posters.isEmpty {
                        Text("Aucun titre.").foregroundStyle(.secondary).padding(.horizontal, 80)
                    } else {
                        LazyVGrid(columns: columns, alignment: .leading, spacing: 40) {
                            ForEach(posters) { poster in
                                PosterButton(poster: poster)
                            }
                        }
                        .padding(.horizontal, 80)
                    }
                }
                .padding(.vertical, 40)
            }
            .withDestinations()
        }
        .task(id: "\(genre ?? "")|\(sort.rawValue)|\(library.version)") {
            posters = library.posters(kind: kind, genre: genre, sort: sort)
        }
    }

    private func chips(title: String, values: [String], selected: String?, pick: @escaping (String) -> Void) -> some View {
        HStack(alignment: .center, spacing: 20) {
            Text(title).font(.headline).foregroundStyle(.secondary).frame(width: 130, alignment: .leading)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 20) {
                    ForEach(values, id: \.self) { value in
                        Button((selected == value ? "✓ " : "") + value) { pick(value) }
                    }
                }
                .padding(.vertical, 20)
            }
        }
        .padding(.horizontal, 80)
    }
}

struct LiveView: View {
    @EnvironmentObject private var library: Library
    @State private var category: String?

    private let columns = [GridItem(.adaptive(minimum: 380), spacing: 40, alignment: .top)]

    private var posters: [Poster] {
        let list = category == nil ? library.channels : library.channels.filter { ($0.cat ?? "Autres") == category }
        return list.prefix(400).map(library.channelPoster)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 20) {
                            Button((category == nil ? "✓ " : "") + "Toutes") { category = nil }
                            ForEach(library.channelCategories(), id: \.self) { name in
                                Button((category == name ? "✓ " : "") + name) { category = (category == name) ? nil : name }
                            }
                        }
                        .padding(.vertical, 20)
                    }
                    .padding(.horizontal, 80)

                    if library.channels.isEmpty {
                        Text("Votre abonnement ne propose pas de chaînes en direct.")
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 80)
                    } else {
                        LazyVGrid(columns: columns, alignment: .leading, spacing: 40) {
                            ForEach(posters) { poster in
                                PosterButton(poster: poster)
                            }
                        }
                        .padding(.horizontal, 80)
                    }
                }
                .padding(.vertical, 40)
            }
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var server: ServerStore

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 30) {
                Text("Réglages").font(.largeTitle.bold())
                Text("Serveur Séance : \(server.url?.absoluteString ?? "—")")
                    .foregroundStyle(.secondary)
                Text("\(library.movies.count) films · \(library.series.count) séries · \(library.channels.count) chaînes")
                    .foregroundStyle(.secondary)
                HStack(spacing: 30) {
                    Button("Actualiser") { Task { await library.load() } }
                    Button("Changer de serveur") { server.forget() }
                }
                Text("L'abonnement IPTV se règle dans Séance, depuis un navigateur : adressez-vous à http://\(server.url?.host ?? "serveur"):\(server.url?.port ?? 8080) pour modifier vos sources.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: 1000, alignment: .leading)
                Spacer()
            }
            .padding(80)
        }
    }
}
