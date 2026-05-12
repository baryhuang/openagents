import SwiftUI
import WebKit

/// Renders a fenced \`\`\`html block as an inline interactive preview inside a
/// chat bubble. Mirrors the visual treatment of `CodeBlockView` (rounded
/// container, on-bubble background) but the body is a sandboxed WKWebView
/// instead of monospace source.
///
/// Sandbox stance:
/// - JavaScript is disabled at the WKPreferences level — agents shipping
///   ```html blocks in chat shouldn't be able to run arbitrary script in the
///   client. If we ever want JS-on artifacts, that becomes an explicit per-
///   workspace opt-in, not the default for in-message previews.
/// - No `baseURL`, so relative URLs and `file://` references don't resolve.
/// - HTTPS subresources (images, stylesheets) are still permitted — banning
///   those would be too restrictive for most demos.
struct HTMLBlockView: View {
    let html: String
    /// True when this block sits inside an agent (light gray) bubble; false on
    /// user (blue) bubbles. Used to pick a contrasting container background.
    var onLightBubble: Bool = true

    /// Cap on the rendered web view height. Long pages scroll inside the
    /// block rather than blowing out the chat. Empirically ~400pt fits a
    /// typical interactive demo without dominating the chat scroll.
    private static let maxRenderedHeight: CGFloat = 400

    /// Reported height of the rendered document. Starts small so the bubble
    /// doesn't reserve a giant slot during the first paint.
    @State private var measuredHeight: CGFloat = 80

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                Image(systemName: "globe")
                    .font(.system(size: 9))
                Text("html")
                    .font(.caption2.monospaced())
            }
            .foregroundStyle(.secondary)
            .padding(.bottom, 4)

            WebView(html: html, measuredHeight: $measuredHeight)
                .frame(height: min(measuredHeight, Self.maxRenderedHeight))
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .padding(8)
        .background(
            (onLightBubble ? Color.black.opacity(0.06) : Color.white.opacity(0.18)),
            in: RoundedRectangle(cornerRadius: 8, style: .continuous),
        )
    }
}

// MARK: - WKWebView wrapper

#if os(macOS)
import AppKit
typealias PlatformWebView = WKWebView
#else
import UIKit
typealias PlatformWebView = WKWebView
#endif

/// SwiftUI bridge for a WKWebView that loads inline HTML and reports its
/// content height back via a binding once the document settles.
private struct WebView {
    let html: String
    @Binding var measuredHeight: CGFloat

    static func makeConfiguration() -> WKWebViewConfiguration {
        let prefs = WKWebpagePreferences()
        prefs.allowsContentJavaScript = false
        let cfg = WKWebViewConfiguration()
        cfg.defaultWebpagePreferences = prefs
        return cfg
    }

    static func makeCoordinator(parent: WebView) -> Coordinator {
        Coordinator(parent: parent)
    }

    /// Wraps the raw HTML in a minimal document scaffold that:
    ///   - declares UTF-8 (so emoji and CJK don't render mojibake);
    ///   - sets `prefers-color-scheme` so embedded forms / inputs match the
    ///     surrounding chat theme;
    ///   - reset body margins to 0 so the measured height matches the visible
    ///     content (the default 8px body margin would inflate the report).
    static func wrappedDocument(_ rawHTML: String) -> String {
        """
        <!doctype html>
        <html><head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
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

    final class Coordinator: NSObject, WKNavigationDelegate {
        let parent: WebView

        init(parent: WebView) {
            self.parent = parent
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // Pull the rendered height once the load settles. Re-queries with a
            // tiny delay so layout has stabilised — without the hop we
            // occasionally read 0 on slow loads.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak webView] in
                webView?.evaluateJavaScript("document.body.scrollHeight") { [weak self] value, _ in
                    guard let height = value as? CGFloat else { return }
                    DispatchQueue.main.async {
                        self?.parent.measuredHeight = max(40, height)
                    }
                }
            }
        }
    }
}

#if os(macOS)
extension WebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero, configuration: Self.makeConfiguration())
        view.navigationDelegate = context.coordinator
        view.setValue(false, forKey: "drawsBackground")
        view.loadHTMLString(Self.wrappedDocument(html), baseURL: nil)
        return view
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        // No live HTML updates for now — messages are immutable after delivery.
    }

    func makeCoordinator() -> Coordinator { Self.makeCoordinator(parent: self) }
}
#else
extension WebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero, configuration: Self.makeConfiguration())
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.loadHTMLString(Self.wrappedDocument(html), baseURL: nil)
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // No live HTML updates for now — messages are immutable after delivery.
    }

    func makeCoordinator() -> Coordinator { Self.makeCoordinator(parent: self) }
}
#endif
