import SwiftUI

/// Séance pour iPhone, iPad et Mac : la même interface que dans le navigateur,
/// dans une fenêtre native (lecture plein écran, AirPlay, adresse mémorisée).
@main
struct SeanceApp: App {
    @StateObject private var server = ServerStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(server)
                .preferredColorScheme(.dark)
        }
        #if os(macOS)
        .commands {
            CommandGroup(after: .appSettings) {
                Button("Changer de serveur…") { server.forget() }
            }
        }
        #endif
    }
}

struct RootView: View {
    @EnvironmentObject private var server: ServerStore
    @State private var failure: String?
    @State private var reloadToken = 0

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let url = server.url {
                SeanceWebView(
                    url: url,
                    reloadToken: reloadToken,
                    failure: $failure,
                    onChangeServer: { server.forget() }
                )
                .ignoresSafeArea()
                .id(url)
                if let failure {
                    FailureView(message: failure,
                                retry: { reloadToken += 1 },
                                change: { server.forget() })
                }
            } else {
                SetupView()
            }
        }
        #if os(macOS)
        .frame(minWidth: 900, minHeight: 600)
        #endif
    }
}

/// Affichée quand le serveur Séance ne répond plus (Mac éteint, autre Wi-Fi…).
struct FailureView: View {
    let message: String
    let retry: () -> Void
    let change: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Text("Séance est injoignable")
                .font(.title2.bold())
            Text(message)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            HStack(spacing: 16) {
                Button("Réessayer", action: retry)
                    .buttonStyle(.borderedProminent)
                Button("Changer de serveur", action: change)
                    .buttonStyle(.bordered)
            }
        }
        .padding(32)
        .frame(maxWidth: 520)
        .background(.ultraThickMaterial, in: RoundedRectangle(cornerRadius: 20))
        .padding()
    }
}
