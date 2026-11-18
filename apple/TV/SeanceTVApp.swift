import SwiftUI

/// Séance pour Apple TV : un client natif qui lit les mêmes données que le site
/// (catalogue, favoris, reprises) auprès du serveur Séance du réseau local.
@main
struct SeanceTVApp: App {
    @StateObject private var server = ServerStore()

    var body: some Scene {
        WindowGroup {
            TVRoot()
                .environmentObject(server)
        }
    }
}

struct TVRoot: View {
    @EnvironmentObject private var server: ServerStore

    var body: some View {
        if let url = server.url {
            LibraryHost(base: url)
                .id(url)
        } else {
            SetupView()
        }
    }
}

/// Crée le catalogue pour l'adresse du serveur et lance son chargement.
struct LibraryHost: View {
    @StateObject private var library: Library

    init(base: URL) {
        _library = StateObject(wrappedValue: Library(api: API(base: base)))
    }

    var body: some View {
        MainTabs()
            .environmentObject(library)
            .task { await library.load() }
    }
}

struct MainTabs: View {
    @EnvironmentObject private var library: Library

    var body: some View {
        TabView {
            HomeView()
                .tabItem { Label("Accueil", systemImage: "house") }
            CatalogView(kind: .movies)
                .tabItem { Label("Films", systemImage: "film") }
            CatalogView(kind: .series)
                .tabItem { Label("Séries", systemImage: "rectangle.stack") }
            LiveView()
                .tabItem { Label("Direct", systemImage: "tv") }
            SettingsView()
                .tabItem { Label("Réglages", systemImage: "gearshape") }
        }
        .fullScreenCover(item: $library.playing) { request in
            PlayerScreen(request: request)
        }
        .onChange(of: library.playing) { playing in
            // Au retour d'une lecture, « Reprendre la lecture » est à jour.
            if playing == nil { library.refreshShelves() }
        }
    }
}
