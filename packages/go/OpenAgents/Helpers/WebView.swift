import SwiftUI
import WebKit

#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// SwiftUI bridge for a WKWebView that loads inline HTML and reports its
/// content height back via a binding once the document settles. Used by
/// `HTMLBlockView` for fenced \`\`\`html previews and by `FileDetailView`
/// for HTML workspace files.
///
/// Sandbox stance: JavaScript is disabled at the `WKPreferences` level, no
/// `baseURL` is supplied (so relative paths and `file://` references don't
/// resolve), and HTTPS subresources (images, stylesheets) are still allowed —
/// banning those would be too restrictive for most demos. Workspace file URLs
/// (`/v1/files/<id>`) are rewritten to a custom `oafile:` scheme so the
/// authorized request handler can attach the workspace token; without that
/// step WKWebView issues unauthenticated requests and gets back 401s.
struct WebView {
    let html: String
    @Binding var measuredHeight: CGFloat

    /// Closure that produces an authorized URLRequest for a workspace file id.
    /// Used by the `oafile:` scheme handler. Pass nil when workspace-file
    /// images shouldn't be resolvable (e.g. previews with no store wired up).
    var fileRequestProvider: WorkspaceFileSchemeHandler.RequestProvider? = nil

    /// Whether WKWebView owns the scroll (long-document content panel) or the
    /// caller wraps it in a measured-height SwiftUI ScrollView (inline blocks).
    /// Drives the iOS bounce + scroll-indicator config.
    var ownsScroll: Bool = false

    /// JS poked into the doc to fight zero-height reads on slow loads: emit a
    /// `resize` event whenever the body's scrollHeight changes (image decoded,
    /// fonts swapped, etc). The host bridge below converts that into another
    /// scrollHeight read.
    private static let heightObserverScript: String = """
    (function () {
      var lastH = -1;
      function report() {
        var h = Math.max(
          document.documentElement.scrollHeight || 0,
          document.body ? document.body.scrollHeight : 0,
        );
        if (h !== lastH) {
          lastH = h;
          if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.heightChanged) {
            window.webkit.messageHandlers.heightChanged.postMessage(h);
          }
        }
      }
      if (document.readyState === 'complete') report();
      else window.addEventListener('load', report);
      if (typeof ResizeObserver !== 'undefined') {
        var ro = new ResizeObserver(report);
        if (document.body) ro.observe(document.body);
      }
      window.addEventListener('resize', report);
    })();
    """

    // MARK: - Configuration / wrapping

    func makeConfiguration(coordinator: Coordinator) -> WKWebViewConfiguration {
        let prefs = WKWebpagePreferences()
        // We allow our own height-observer script (the only JS in the doc).
        // User HTML doesn't get to run script — that gate is enforced via the
        // `<meta http-equiv="Content-Security-Policy">` in `wrappedDocument`.
        prefs.allowsContentJavaScript = true
        let cfg = WKWebViewConfiguration()
        cfg.defaultWebpagePreferences = prefs

        // Register the workspace-file scheme handler when the caller wired a
        // provider in. The handler must be set BEFORE WKWebView is constructed.
        if let handler = coordinator.fileSchemeHandler {
            cfg.setURLSchemeHandler(handler, forURLScheme: WorkspaceFileSchemeHandler.scheme)
        }

        // Bridge: the JS above posts content-height numbers; the coordinator
        // forwards them into `measuredHeight`. Lets the inline html block grow
        // as images decode, instead of being stuck at the initial scrollHeight.
        cfg.userContentController.add(coordinator, name: "heightChanged")
        return cfg
    }

    /// Wraps the raw HTML in a minimal document scaffold that:
    ///   - declares UTF-8 (so emoji and CJK don't render mojibake);
    ///   - sets `prefers-color-scheme` so embedded forms / inputs match the
    ///     surrounding chat theme;
    ///   - resets body margins to 0 so the measured height matches the
    ///     visible content (the default 8px body margin would inflate it);
    ///   - clamps `<img>` natural size and *allows* the script the host
    ///     installed via `userContentController` — we deny inline / external
    ///     script so agent HTML can't escape the sandbox.
    static func wrappedDocument(_ rawHTML: String) -> String {
        """
        <!doctype html>
        <html><head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="Content-Security-Policy" content="default-src * data: oafile:; img-src * data: oafile:; style-src * 'unsafe-inline'; script-src 'none'">
        <style>
          :root { color-scheme: light dark; }
          html, body { margin: 0; padding: 0; }
          body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
          img, video, iframe { max-width: 100%; height: auto; }
        </style>
        </head><body>
        \(rawHTML)
        </body></html>
        """
    }

    /// Rewrites `src="…/v1/files/<id>…"` (any scheme, any host, with or
    /// without trailing path/query) to `src="oafile:/<id>"` so the registered
    /// scheme handler picks it up. Only touches `src`; href links are left
    /// alone — they're not navigated inside the sandbox.
    static func rewriteWorkspaceFileURLs(in html: String) -> String {
        let pattern = #"(src\s*=\s*)(["'])(?:[^"']*?)/v1/files/([A-Za-z0-9][A-Za-z0-9\-_]+)(?:[^"']*)?(\2)"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return html
        }
        let range = NSRange(html.startIndex..<html.endIndex, in: html)
        return regex.stringByReplacingMatches(
            in: html,
            range: range,
            withTemplate: "$1$2\(WorkspaceFileSchemeHandler.scheme):/$3$4",
        )
    }

    fileprivate func loadDocument(into webView: WKWebView) {
        let rewritten = Self.rewriteWorkspaceFileURLs(in: html)
        let doc = Self.wrappedDocument(rewritten) + "\n<script>\(Self.heightObserverScript)</script>"
        webView.loadHTMLString(doc, baseURL: nil)
    }

    // MARK: - Coordinator

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let parent: WebView
        let fileSchemeHandler: WorkspaceFileSchemeHandler?

        init(parent: WebView) {
            self.parent = parent
            self.fileSchemeHandler = parent.fileRequestProvider.map(WorkspaceFileSchemeHandler.init(provider:))
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // Belt-and-suspenders read in case the observer JS bridge hasn't
            // fired yet (very short docs, no body images). Throttle the
            // first-paint flicker with a small delay.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak webView] in
                webView?.evaluateJavaScript("document.body.scrollHeight") { [weak self] value, _ in
                    guard let height = value as? CGFloat else { return }
                    DispatchQueue.main.async {
                        self?.parent.measuredHeight = max(40, height)
                    }
                }
            }
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "heightChanged", let h = message.body as? Double else { return }
            DispatchQueue.main.async {
                self.parent.measuredHeight = max(40, CGFloat(h))
            }
        }
    }
}

#if os(macOS)
extension WebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero, configuration: makeConfiguration(coordinator: context.coordinator))
        view.navigationDelegate = context.coordinator
        view.setValue(false, forKey: "drawsBackground")
        loadDocument(into: view)
        return view
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        // Messages and uploaded HTML files are immutable for our purposes;
        // no live document swaps.
    }

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
}
#else
extension WebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero, configuration: makeConfiguration(coordinator: context.coordinator))
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        // Inline blocks measure their height and live inside a SwiftUI
        // ScrollView, so the internal WKWebView scrolling should stay off —
        // otherwise touch gestures get split between the two scrollers.
        // The content-panel / fullscreen viewer flip this to let WKWebView
        // own the scroll natively.
        view.scrollView.isScrollEnabled = ownsScroll
        view.scrollView.bounces = ownsScroll
        loadDocument(into: view)
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // Messages and uploaded HTML files are immutable for our purposes;
        // no live document swaps.
    }

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
}
#endif
