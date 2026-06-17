import SwiftUI

/// Owns the active `AppDestination` for the current workspace and routes
/// to the matching surface.
///
/// **iPhone (compact):** `TabView` with three tabs — Chats / Inbox /
/// Settings — each backed by a NavigationSplitView that auto-collapses
/// to a NavigationStack on the phone. Replaces the pre-v0.6 segmented
/// control + sidebar-footer pattern.
///
/// **iPad / Mac:** still the existing 2-column NavigationSplitView. The
/// destination toggles content in the leading column via the segmented
/// picker inside `ThreadListView`; Phase 4 of issue #13 replaces that
/// with a left icon rail. Settings is rendered full-screen when
/// destination switches.
struct WorkspaceView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(AppRouter.self) private var router
    @StateObject private var sessionRead = SessionReadStore.shared

    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var destination: AppDestination = .chats

    // Connect-agents page: auto-shown once per workspace when the workspace has
    // genuinely no agents (e.g. right after creating one). Gated on the store's
    // own load state so an in-flight bootstrap isn't mistaken for "no agents".
    @State private var showConnectAgents = false
    @State private var connectAgentsAutoShown = false

    /// Per-destination unread counts derived from `WorkspaceStore` + the
    /// shared `SessionReadStore`. Recomputed each render — cheap because
    /// session lists are O(tens), not O(thousands).
    private var unreadCounts: [AppDestination: Int] {
        var counts: [AppDestination: Int] = [:]
        for session in store.activeSessions {
            guard sessionRead.isUnread(
                workspaceId: store.workspaceId,
                sessionId: session.sessionId,
                lastEventAt: session.lastEventAt,
            ) else { continue }
            let bucket: AppDestination = session.isRoutineChannel ? .inbox : .chats
            counts[bucket, default: 0] += 1
        }
        return counts
    }

    var body: some View {
        rootContent
            .sheet(isPresented: $showConnectAgents) {
                ConnectAgentsView(onClose: { showConnectAgents = false })
                    .environment(store)
            }
            .onAppear { presentConnectAgentsIfEmpty() }
            .onChange(of: store.isLoading) { _, _ in presentConnectAgentsIfEmpty() }
            .onChange(of: store.agents.count) { _, _ in presentConnectAgentsIfEmpty() }
            .onChange(of: store.workspaceId) { _, _ in
                connectAgentsAutoShown = false
                presentConnectAgentsIfEmpty()
            }
    }

    /// Auto-present the connect-agents page at most once per workspace, and
    /// ONLY after the store's initial load has completed — `bootstrap()` flips
    /// `isLoading` to false only after discovery has populated `agents`, so
    /// before that an agent-having workspace still reads as empty. This reads
    /// the store's own state instead of kicking off a second (racing)
    /// discovery, which was the false-positive bug.
    private func presentConnectAgentsIfEmpty() {
        guard !store.isLoading, store.agents.isEmpty, !connectAgentsAutoShown else { return }
        connectAgentsAutoShown = true
        showConnectAgents = true
    }

    @ViewBuilder
    private var rootContent: some View {
        #if os(iOS)
        iPhoneTabBar
        #else
        macSplit
        #endif
    }

    // MARK: - iPhone

    #if os(iOS)
    private var iPhoneTabBar: some View {
        let counts = unreadCounts
        return TabView(selection: $destination) {
            destinationTab(.chats, badge: counts[.chats] ?? 0) {
                NavigationSplitView {
                    ThreadListView(destination: $destination)
                } detail: {
                    ChatView()
                }
                .navigationSplitViewStyle(.balanced)
            }
            destinationTab(.inbox, badge: counts[.inbox] ?? 0) {
                NavigationSplitView {
                    ThreadListView(destination: $destination)
                } detail: {
                    ChatView()
                }
                .navigationSplitViewStyle(.balanced)
            }
            destinationTab(.settings, badge: 0) {
                NavigationStack {
                    SettingsTabContent()
                        .navigationTitle("Settings")
                        .navigationBarTitleDisplayMode(.large)
                }
            }
        }
        .tint(BrandColors.primary)
    }

    @ViewBuilder
    private func destinationTab<Content: View>(
        _ d: AppDestination,
        badge: Int,
        @ViewBuilder content: () -> Content,
    ) -> some View {
        content()
            .tabItem {
                Label(d.label, systemImage: destination == d ? d.iconFilled : d.icon)
            }
            .badge(badge > 0 ? badge : 0)
            .tag(d)
    }
    #endif

    // MARK: - Mac (Phase 4 will replace this with an icon rail)

    #if os(macOS)
    private var macSplit: some View {
        HStack(spacing: 0) {
            IconRailView(
                destination: $destination,
                workspaceName: store.workspace?.name ?? "Workspace",
                unreadCounts: unreadCounts,
                onSwitchWorkspace: { router.switchWorkspace() },
            )
            macDestinationContent
        }
    }

    @ViewBuilder
    private var macDestinationContent: some View {
        switch destination {
        case .chats, .inbox:
            NavigationSplitView(columnVisibility: $columnVisibility) {
                ThreadListView(destination: $destination)
                    .navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 400)
            } detail: {
                ChatView()
            }
            .navigationSplitViewStyle(.balanced)
        case .settings:
            SettingsTabContent()
        }
    }
    #endif
}
