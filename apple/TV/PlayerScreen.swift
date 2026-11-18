import SwiftUI
import AVKit
import Combine

/// Une façon de lire le flux : l'adresse, et la position (en secondes) de son début dans le film.
private struct Plan {
    let path: String
    let offset: Double
    let seek: Double
}

private enum PlayerFailure: LocalizedError {
    case needsConversion
    case unplayable

    var errorDescription: String? {
        switch self {
        case .needsConversion:
            return "Cette vidéo (MKV, AVI ou son AC3/DTS) n'est pas lisible sur Apple TV. Installez ffmpeg sur l'ordinateur qui fait tourner Séance : elle la convertira automatiquement."
        case .unplayable:
            return "Le flux ne répond pas. Vérifiez votre abonnement (nombre de connexions simultanées) et que le serveur Séance est allumé."
        }
    }
}

@MainActor
final class PlayerModel: ObservableObject {
    @Published var player: AVPlayer?
    @Published var loading = true
    @Published var error: String?

    private weak var library: Library?
    private var current: PlayRequest?
    private var timeObserver: Any?
    private var endTask: Task<Void, Never>?
    private var offset: Double = 0
    private var knownDuration: Double = 0
    private var stopped = false

    func start(_ request: PlayRequest, library: Library) async {
        self.library = library
        await load(request)
    }

    func stop() {
        stopped = true
        saveProgress()
        detach()
        player?.pause()
        player = nil
    }

    // MARK: Chargement

    private func plans(for request: PlayRequest, info: PlayInfo) -> [Plan] {
        if request.kind == "channel" {
            // AVPlayer ne lit pas le MPEG-TS brut : on préfère la variante HLS quand elle existe.
            var list = [Plan(path: info.url, offset: 0, seek: 0)]
            if let alt = info.alt, alt.type == "hls" {
                let hls = Plan(path: alt.url, offset: 0, seek: 0)
                list = info.type == "hls" ? list + [hls] : [hls] + list
            }
            return list
        }
        let native = ["mp4", "m4v", "mov"].contains((info.ext ?? "").lowercased())
        var list: [Plan] = []
        if native || info.convertHls == nil {
            list.append(Plan(path: info.url, offset: 0, seek: request.startAt))
        }
        if let hls = info.convertHls {
            let start = Int(request.startAt)
            list.append(Plan(path: "\(hls)?t=\(start)", offset: Double(start), seek: 0))
        }
        return list
    }

    private func load(_ request: PlayRequest) async {
        guard let library else { return }
        current = request
        loading = true
        error = nil
        detach()
        do {
            let info: PlayInfo = try await library.api.get("/api/play/" + enc(request.id))
            for plan in plans(for: request, info: info) {
                if stopped { return }
                let item = AVPlayerItem(url: library.api.url(plan.path))
                let player = self.player ?? AVPlayer()
                self.player = player
                player.replaceCurrentItem(with: item)
                if await waitReady(item) {
                    offset = plan.offset
                    if plan.seek > 20 {
                        await player.seek(to: CMTime(seconds: plan.seek, preferredTimescale: 600))
                    }
                    player.play()
                    loading = false
                    attach(player, item: item, converted: plan.offset > 0 || plan.path.contains("convert-hls"))
                    return
                }
            }
            let canConvert = info.convertHls != nil
            throw (request.kind == "channel" || canConvert) ? PlayerFailure.unplayable : PlayerFailure.needsConversion
        } catch {
            self.error = error.localizedDescription
            loading = false
        }
    }

    /// Attend que le flux soit prêt ou en échec (40 s au plus : une conversion met quelques secondes à démarrer).
    private func waitReady(_ item: AVPlayerItem, timeout: Double = 40) async -> Bool {
        await withTaskGroup(of: Bool.self) { group in
            group.addTask { @MainActor in
                for await status in item.publisher(for: \.status).values {
                    if status == .readyToPlay { return true }
                    if status == .failed { return false }
                }
                return false
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                return false
            }
            let first = await group.next() ?? false
            group.cancelAll()
            return first
        }
    }

    // MARK: Suivi de la lecture

    private func attach(_ player: AVPlayer, item: AVPlayerItem, converted: Bool) {
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 10, preferredTimescale: 1), queue: .main) { [weak self] _ in
            Task { @MainActor in self?.saveProgress() }
        }
        endTask = Task { [weak self] in
            for await _ in NotificationCenter.default.notifications(named: .AVPlayerItemDidPlayToEndTime, object: item) {
                await self?.finished()
                break
            }
        }
        if converted {
            knownDuration = 0
            let id = current?.id ?? ""
            Task { [weak self] in
                guard let library = self?.library else { return }
                if let probe: ProbeResponse = try? await library.api.get("/api/probe/" + enc(id)) {
                    self?.knownDuration = Double(probe.duration)
                }
            }
        } else {
            let seconds = item.duration.seconds
            knownDuration = seconds.isFinite ? seconds : 0
        }
    }

    private func detach() {
        if let observer = timeObserver, let player {
            player.removeTimeObserver(observer)
        }
        timeObserver = nil
        endTask?.cancel()
        endTask = nil
    }

    private func saveProgress(done: Bool = false) {
        guard let request = current, let library, let player, request.kind != "channel" else { return }
        let position = offset + player.currentTime().seconds
        guard position.isFinite, position >= 5 || done else { return }
        let finished = done || (knownDuration > 0 && position / knownDuration > 0.93)
        library.saveProgress(key: request.key, position: position, duration: knownDuration, done: finished, request: request)
    }

    private func finished() async {
        saveProgress(done: true)
        guard var next = current, let first = next.queue.first else {
            library?.playing = nil
            return
        }
        next.id = first.id
        next.key = first.id
        next.sub = first.sub
        next.poster = first.poster
        next.queue = Array(next.queue.dropFirst())
        next.startAt = 0
        await load(next)
    }
}

struct PlayerScreen: View {
    let request: PlayRequest
    @EnvironmentObject private var library: Library
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model = PlayerModel()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let player = model.player {
                VideoPlayer(player: player)
                    .ignoresSafeArea()
            }
            if model.loading && model.error == nil {
                ProgressView("Préparation de la lecture…")
            }
            if let message = model.error {
                VStack(spacing: 24) {
                    Text("Lecture impossible").font(.title2.bold())
                    Text(message)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: 900)
                    Button("Fermer") { dismiss() }
                }
                .padding(60)
            }
        }
        .task { await model.start(request, library: library) }
        .onDisappear { model.stop() }
    }
}
