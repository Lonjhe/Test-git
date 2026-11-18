import SwiftUI

/// Dégradé stable propre à un titre, affiché tant que l'image n'est pas là (ou s'il n'y en a pas).
private func hue(for text: String) -> Double {
    var hash: UInt32 = 2166136261
    for scalar in text.unicodeScalars {
        hash = (hash ^ scalar.value) &* 16777619
    }
    return Double(hash % 360) / 360
}

struct RemoteImage: View {
    let path: String?
    let title: String
    var fit = false
    @EnvironmentObject private var library: Library

    var body: some View {
        let h = hue(for: title)
        ZStack {
            LinearGradient(colors: [Color(hue: h, saturation: 0.5, brightness: 0.45),
                                    Color(hue: (h + 0.13).truncatingRemainder(dividingBy: 1), saturation: 0.6, brightness: 0.2)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
            Text(title)
                .font(.callout.bold())
                .multilineTextAlignment(.center)
                .padding(12)
            if let url = library.api.imageURL(path) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        if fit {
                            image.resizable().scaledToFit().padding(24)
                        } else {
                            image.resizable().scaledToFill()
                        }
                    }
                }
            }
        }
    }
}

struct PosterCard: View {
    let poster: Poster

    private var width: CGFloat { poster.wide ? 400 : 230 }
    private var height: CGFloat { poster.wide ? 225 : 345 }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            RemoteImage(path: poster.image, title: poster.title, fit: poster.fit)
                .frame(width: width, height: height)
                .clipped()
                .overlay(alignment: .bottom) {
                    if poster.progress > 0.02 {
                        ProgressView(value: min(poster.progress, 1))
                            .padding(.horizontal, 16)
                            .padding(.bottom, 14)
                    }
                }
            Text(poster.title)
                .font(.caption.bold())
                .lineLimit(1)
                .frame(width: width, alignment: .leading)
            Text(poster.subtitle.isEmpty ? " " : poster.subtitle)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .frame(width: width, alignment: .leading)
        }
    }
}

/// Une affiche sur laquelle on peut se placer : ouvre une fiche ou lance la lecture.
struct PosterButton: View {
    let poster: Poster
    @EnvironmentObject private var library: Library

    var body: some View {
        switch poster.action {
        case .open(let route):
            NavigationLink(value: route) { PosterCard(poster: poster) }
                .buttonStyle(.card)
        case .play(let request):
            Button { library.playing = request } label: { PosterCard(poster: poster) }
                .buttonStyle(.card)
        }
    }
}

struct ShelfView: View {
    let shelf: Shelf

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(shelf.title)
                .font(.title3.bold())
                .padding(.horizontal, 80)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 40) {
                    ForEach(shelf.items) { poster in
                        PosterButton(poster: poster)
                    }
                }
                .padding(.horizontal, 80)
                .padding(.vertical, 30)
            }
        }
    }
}

struct MessageView: View {
    let title: String
    let text: String
    var buttonTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 24) {
            Text(title).font(.title2.bold())
            Text(text)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .frame(maxWidth: 900)
            if let buttonTitle, let action {
                Button(buttonTitle, action: action)
            }
        }
        .padding(60)
    }
}

extension View {
    /// Fiches ouvertes depuis une affiche.
    func withDestinations() -> some View {
        navigationDestination(for: Route.self) { route in
            switch route {
            case .movie(let movie): MovieDetailView(movie: movie)
            case .series(let show): SeriesDetailView(show: show)
            }
        }
    }
}
