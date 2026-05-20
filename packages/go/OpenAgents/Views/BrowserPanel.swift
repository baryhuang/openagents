import SwiftUI
import WebKit

#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Right-side panel that embeds a live Browser Fabric session. v1 shows the
/// workspace's single most-recent live tab (`store.liveBrowserTab`) — we
/// don't surface a tab list. The body is a WKWebView pointed at the tab's
/// `liveUrl`; reload re-fetches a validated tab object (which auto-wakes a
/// dead session backend-side) and reissues the load.
struct BrowserPanel: View {
    @Environment(WorkspaceStore.self) private var store

    /// Snapshot of the tab currently being rendered. We track this locally so
    /// we can rebuild the WebView when the underlying liveUrl changes — the
    /// store's `liveBrowserTab` may change beneath us mid-poll.
    @State private var loadedTabId: String?
    @State private var loadedLiveUrl: String?
    @State private var isReloading: Bool = false
    @State private var loadError: String?

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
        }
        .task(id: store.liveBrowserTab?.id) {
            await loadFreshIfNeeded()
        }
        .onChange(of: store.liveBrowserTab?.liveUrl) { _, newURL in
            // If the backend rotated the liveUrl (e.g. session reconnected)
            // pick it up without a full panel teardown.
            loadedLiveUrl = newURL
        }
    }

    // MARK: - Header

    @ViewBuilder
    private var header: some View {
        if let tab = store.liveBrowserTab {
            HStack(alignment: .center, spacing: 8) {
                Image(systemName: "globe")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 1) {
                    Text(tab.title ?? "Browser")
                        .font(.system(size: 12, weight: .semibold))
                        .lineLimit(1)
                        .truncationMode(.tail)
                    if let url = tab.url, !url.isEmpty {
                        Text(url)
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    } else if let agent = tab.agentName {
                        Text("opened by \(agent)")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 4)
                Button {
                    Task { await reload(tabId: tab.id) }
                } label: {
                    ZStack {
                        Image(systemName: "arrow.clockwise")
                            .opacity(isReloading ? 0 : 1)
                        if isReloading {
                            ProgressView().controlSize(.small)
                        }
                    }
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(width: 22, height: 22)
                }
                .buttonStyle(.plain)
                .disabled(isReloading)
                .accessibilityLabel("Reload browser session")
                #if os(macOS)
                .help("Reload session")
                #endif
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if let liveUrl = loadedLiveUrl,
           let url = URL(string: liveUrl) {
            BrowserWebView(url: url)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let err = loadError {
            VStack(spacing: 10) {
                Image(systemName: "exclamationmark.triangle")
                    .foregroundStyle(.orange)
                Text(err)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                if let tab = store.liveBrowserTab {
                    Button("Retry") { Task { await reload(tabId: tab.id) } }
                        .buttonStyle(.bordered)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding()
        } else {
            // Empty state: panel was opened but the live URL isn't ready yet
            // (validation in flight, or the store's `liveBrowserTab` is
            // momentarily nil). The tabbed parent only shows the Browser tab
            // when a live session exists, so this is mostly transient.
            VStack(spacing: 10) {
                ProgressView()
                Text("Connecting to browser session…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // MARK: - Loading

    /// On first render (or when the live tab id changes), ask the backend to
    /// `?validate=true` the tab — that auto-reconnects expired sessions and
    /// returns the freshest `liveUrl`. Then load it.
    private func loadFreshIfNeeded() async {
        guard let tab = store.liveBrowserTab else {
            loadedTabId = nil
            loadedLiveUrl = nil
            return
        }
        if loadedTabId == tab.id, loadedLiveUrl == tab.liveUrl { return }
        await reload(tabId: tab.id)
    }

    private func reload(tabId: String) async {
        isReloading = true
        defer { isReloading = false }
        do {
            let validated = try await store.validateBrowserTab(tabId: tabId)
            loadedTabId = validated.id
            loadedLiveUrl = validated.liveUrl
            loadError = (validated.liveUrl?.isEmpty != false) ? "Session is not live yet — try again in a moment." : nil
        } catch {
            loadError = error.localizedDescription
            logError("browser", "validate tab failed: \(error.localizedDescription)")
        }
    }
}

// MARK: - Web view bridge

/// Minimal WKWebView wrapper that loads a remote URL and lets WKWebView own
/// scrolling. Distinct from `WebView` (which loads raw HTML strings); we
/// don't reuse that one because we want a remote URL load, no measured
/// height, no oafile scheme handler.
private struct BrowserWebView {
    let url: URL
}

#if os(macOS)
extension BrowserWebView: NSViewRepresentable {
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
extension BrowserWebView: UIViewRepresentable {
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
