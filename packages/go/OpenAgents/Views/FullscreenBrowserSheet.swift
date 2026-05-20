import SwiftUI
import WebKit

#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Modal viewer for the Browser Fabric live session. Used by `BrowserPanel`
/// when the user taps the expand button — opens a take-over view sized to
/// dominate the app frame so the embedded WKWebView has real space to work
/// with. Browser Fabric sessions persist server-side, so re-rendering the
/// iframe in the modal doesn't lose state — it just re-attaches.
///
/// Mirrors `FullscreenHTMLSheet` but loads a remote URL via WKWebView's own
/// scrolling (no measured-height, no `oafile:` scheme handler).
struct FullscreenBrowserSheet: View {
    let liveUrl: String
    let title: String
    let url: String?

    @Binding var isPresented: Bool

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if let resolved = URL(string: liveUrl) {
                FullscreenBrowserWebView(url: resolved)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                    Text("Couldn't parse live URL")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        #if os(macOS)
        // macOS sheets need explicit sizing — without these the system
        // shrinks the modal to the smallest content fit. Match
        // FullscreenHTMLSheet for visual consistency.
        .frame(minWidth: 720, idealWidth: 1100, minHeight: 540, idealHeight: 800)
        #endif
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "globe")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                    .truncationMode(.tail)
                if let url, !url.isEmpty {
                    Text(url)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            Spacer(minLength: 0)
            Button {
                isPresented = false
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .padding(6)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close fullscreen browser viewer")
            #if os(macOS)
            .help("Close")
            #endif
            .keyboardShortcut(.cancelAction)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }
}

// MARK: - Web view (URL load, native scroll)

/// Same shape as `BrowserPanel.BrowserWebView` (which is private), kept here
/// so the fullscreen sheet doesn't need to reach across files for a WKWebView
/// representable. Keeping them separate also means the modal's WKWebView is a
/// distinct instance — opening / closing the sheet doesn't disturb the
/// in-panel rendering.
private struct FullscreenBrowserWebView {
    let url: URL
}

#if os(macOS)
extension FullscreenBrowserWebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView {
        let view = WKWebView()
        view.load(URLRequest(url: url))
        return view
    }
    func updateNSView(_ nsView: WKWebView, context: Context) {
        if nsView.url != url {
            nsView.load(URLRequest(url: url))
        }
    }
}
#else
extension FullscreenBrowserWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let view = WKWebView()
        view.load(URLRequest(url: url))
        return view
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {
        if uiView.url != url {
            uiView.load(URLRequest(url: url))
        }
    }
}
#endif
