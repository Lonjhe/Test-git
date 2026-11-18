import SwiftUI

/// Premier écran : saisie de l'adresse du serveur Séance.
struct SetupView: View {
    @EnvironmentObject private var server: ServerStore
    @State private var address = ""
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        VStack(spacing: 28) {
            Image(systemName: "play.rectangle.fill")
                .font(.system(size: 72))
            Text("Connexion à Séance")
                .font(.largeTitle.bold())
            Text("Saisissez l'adresse affichée par Séance quand vous la lancez sur votre ordinateur, par exemple 192.168.1.20:8080.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            field

            if let message {
                Text(message)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }

            Button {
                Task { await connect() }
            } label: {
                if busy {
                    ProgressView()
                } else {
                    Text("Se connecter")
                }
            }
            .disabled(busy || address.trimmingCharacters(in: .whitespaces).isEmpty)
            #if !os(tvOS)
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            #endif
        }
        .padding(40)
        .frame(maxWidth: 640)
    }

    @ViewBuilder
    private var field: some View {
        #if os(iOS)
        TextField("Adresse du serveur", text: $address)
            .textFieldStyle(.roundedBorder)
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .onSubmit { Task { await connect() } }
        #elseif os(macOS)
        TextField("Adresse du serveur", text: $address)
            .textFieldStyle(.roundedBorder)
            .onSubmit { Task { await connect() } }
        #else
        TextField("Adresse du serveur", text: $address)
            .onSubmit { Task { await connect() } }
        #endif
    }

    private func connect() async {
        guard !busy else { return }
        busy = true
        message = nil
        do {
            try await server.connect(address)
        } catch {
            message = error.localizedDescription
        }
        busy = false
    }
}
