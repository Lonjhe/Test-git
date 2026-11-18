import SwiftUI
import WebKit

#if os(macOS)
typealias PlatformRepresentable = NSViewRepresentable
#else
typealias PlatformRepresentable = UIViewRepresentable
#endif

/// Affiche l'interface web de Séance dans une WKWebView.
struct SeanceWebView: PlatformRepresentable {
    let url: URL
    let reloadToken: Int
    @Binding var failure: String?
    let onChangeServer: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    private func makeWebView(_ context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsAirPlayForMediaPlayback = true
        // La page reconnaît ce nom pour proposer « Changer de serveur » dans les réglages.
        config.applicationNameForUserAgent = "SeanceApp/1.0"
        config.userContentController.add(context.coordinator, name: "seance")
        config.preferences.isElementFullscreenEnabled = true
        #if os(iOS)
        config.allowsInlineMediaPlayback = true
        #endif

        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        #if os(iOS)
        view.isOpaque = false
        view.backgroundColor = .black
        view.scrollView.backgroundColor = .black
        view.scrollView.contentInsetAdjustmentBehavior = .never
        #else
        view.setValue(false, forKey: "drawsBackground")
        #endif
        view.load(URLRequest(url: url))
        return view
    }

    private func refresh(_ view: WKWebView, _ context: Context) {
        context.coordinator.parent = self
        if reloadToken != context.coordinator.lastToken {
            context.coordinator.lastToken = reloadToken
            view.load(URLRequest(url: url))
        }
    }

    #if os(macOS)
    func makeNSView(context: Context) -> WKWebView { makeWebView(context) }
    func updateNSView(_ view: WKWebView, context: Context) { refresh(view, context) }
    #else
    func makeUIView(context: Context) -> WKWebView { makeWebView(context) }
    func updateUIView(_ view: WKWebView, context: Context) { refresh(view, context) }
    #endif

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        var parent: SeanceWebView
        var lastToken: Int

        init(_ parent: SeanceWebView) {
            self.parent = parent
            self.lastToken = parent.reloadToken
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            if (message.body as? String) == "changeServer" {
                DispatchQueue.main.async { self.parent.onChangeServer() }
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.async { self.parent.failure = nil }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            report(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            report(error)
        }

        private func report(_ error: Error) {
            let ns = error as NSError
            if ns.code == NSURLErrorCancelled { return }
            DispatchQueue.main.async {
                self.parent.failure = "Impossible de joindre le serveur Séance (\(ns.localizedDescription))."
            }
        }

        /// Les liens vers d'autres sites (bande-annonce, aide…) s'ouvrent dans le navigateur.
        func webView(_ webView: WKWebView,
                     decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let target = action.request.url else {
                decisionHandler(.allow)
                return
            }
            let sameServer = target.host == parent.url.host && target.port == parent.url.port
            let isWeb = target.scheme == "http" || target.scheme == "https"
            if action.targetFrame == nil || (isWeb && !sameServer && action.navigationType == .linkActivated) {
                openExternally(target)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
        }

        func webView(_ webView: WKWebView,
                     createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction,
                     windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let target = action.request.url { openExternally(target) }
            return nil
        }

        private func openExternally(_ url: URL) {
            #if os(macOS)
            NSWorkspace.shared.open(url)
            #else
            UIApplication.shared.open(url)
            #endif
        }
    }
}
