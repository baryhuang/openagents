import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Per-agent routine queues — each agent gets one channel
/// (`routines:<agent>`) per workspace, and every routine the agent owns
/// fires into it. These live in the Inbox tab; everything else lives
/// in Chats.
private let routineChannelPrefix = "routines:"

extension Session {
    var isRoutineChannel: Bool { sessionId.hasPrefix(routineChannelPrefix) }
    var routineAgentName: String? {
        guard isRoutineChannel else { return nil }
        return String(sessionId.dropFirst(routineChannelPrefix.count))
    }
}

/// Tracks the last "read" timestamp for routine (Inbox) channels per
/// workspace. Persisted in `UserDefaults` so unread state survives app
/// restarts. Mirrors the web frontend's `localStorage` map at
/// `inbox-read:<workspaceId>` — same key format, same shape:
/// `sessionId → lastReadAt (unix ms)`. A routine session is "unread"
/// when its `lastEventAt > lastReadAt`.
@MainActor
final class InboxReadStore: ObservableObject {
    static let shared = InboxReadStore()

    @Published private var maps: [String: [String: Int64]] = [:]

    private init() {}

    private static func defaultsKey(workspaceId: String) -> String {
        "inbox-read:\(workspaceId)"
    }

    private func loadIfNeeded(workspaceId: String) {
        guard maps[workspaceId] == nil else { return }
        let key = Self.defaultsKey(workspaceId: workspaceId)
        if let data = UserDefaults.standard.data(forKey: key),
           let decoded = try? JSONDecoder().decode([String: Int64].self, from: data) {
            maps[workspaceId] = decoded
        } else {
            maps[workspaceId] = [:]
        }
    }

    private func persist(workspaceId: String) {
        guard let map = maps[workspaceId] else { return }
        let key = Self.defaultsKey(workspaceId: workspaceId)
        if let data = try? JSONEncoder().encode(map) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    func lastReadAt(workspaceId: String, sessionId: String) -> Int64 {
        loadIfNeeded(workspaceId: workspaceId)
        return maps[workspaceId]?[sessionId] ?? 0
    }

    func markRead(workspaceId: String, sessionId: String, timestamp: Int64?) {
        guard let ts = timestamp, ts > 0 else { return }
        loadIfNeeded(workspaceId: workspaceId)
        var map = maps[workspaceId] ?? [:]
        if (map[sessionId] ?? 0) >= ts { return }
        map[sessionId] = ts
        maps[workspaceId] = map
        persist(workspaceId: workspaceId)
    }

    func isUnread(workspaceId: String, sessionId: String, lastEventAt: Int64?) -> Bool {
        guard let ts = lastEventAt, ts > 0 else { return false }
        return ts > lastReadAt(workspaceId: workspaceId, sessionId: sessionId)
    }
}

private enum SidebarTab: String, Hashable, CaseIterable {
    case chats
    case inbox

    var label: String {
        switch self {
        case .chats: return "Chats"
        case .inbox: return "Inbox"
        }
    }
}

struct ThreadListView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(AppRouter.self) private var router
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var inboxRead = InboxReadStore.shared

    @State private var searchText: String = ""
    @State private var newThreadOpen: Bool = false
    @State private var renamingSession: Session?
    @State private var renameDraft: String = ""
    @State private var activeTab: SidebarTab = .chats

    private var filteredSessions: [Session] {
        let sessions = store.activeSessions
        let q = searchText.trimmingCharacters(in: .whitespaces).lowercased()
        if q.isEmpty { return sessions }
        return sessions.filter { $0.title.lowercased().contains(q) }
    }

    private var regularSessions: [Session] {
        filteredSessions.filter { !$0.isRoutineChannel }
    }

    private var routineSessions: [Session] {
        filteredSessions
            .filter { $0.isRoutineChannel }
            .sorted { ($0.lastEventAt ?? 0) > ($1.lastEventAt ?? 0) }
    }

    private var inboxUnreadCount: Int {
        routineSessions.filter {
            inboxRead.isUnread(
                workspaceId: store.workspaceId,
                sessionId: $0.sessionId,
                lastEventAt: $0.lastEventAt,
            )
        }.count
    }

    private var visibleSessions: [Session] {
        // Search spans both tabs (current behavior was searching the whole
        // session list); when the user is searching, fall back to the
        // chats tab presentation rather than splitting hits across two
        // surfaces.
        if !searchText.trimmingCharacters(in: .whitespaces).isEmpty {
            return filteredSessions
        }
        return activeTab == .chats ? regularSessions : routineSessions
    }

    var body: some View {
        VStack(spacing: 0) {
            #if os(macOS)
            // macOS NavigationSplitView doesn't surface the sidebar column's
            // navigationTitle anywhere visible by default — render it in-content
            // so the workspace name is always present at the top of the list.
            workspaceHeader
            Divider()
            #endif
            if searchText.trimmingCharacters(in: .whitespaces).isEmpty {
                tabPicker
            }
            list
            if auth.user != nil {
                Divider()
                accountFooter
            }
        }
        #if os(macOS)
        .navigationTitle(store.workspace?.name ?? "Workspace")
        .navigationSubtitle(store.workspace?.slug ?? store.workspaceId)
        #else
        // iPhone shows the workspace name inline with the switch-workspace
        // button (see .topBarLeading toolbar item) so leave the navbar title
        // empty — otherwise it'd duplicate the name above the row.
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .searchable(text: $searchText, placement: .toolbar, prompt: "Search")
        .toolbar {
            #if os(iOS)
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    router.switchWorkspace()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "rectangle.stack")
                            .font(.system(size: 14, weight: .medium))
                        Text(store.workspace?.name ?? "Workspace")
                            .font(.system(size: 14, weight: .semibold))
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                }
                .accessibilityLabel("Switch workspace")
            }
            ToolbarItem(placement: .topBarTrailing) {
                browserToggleButton
            }
            #endif
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task {
                        await store.refreshDiscovery()
                        await store.refreshPreviews()
                        if let id = store.currentSessionId {
                    await store.pollNewMessages(channel: id)
                }
                    }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .help("Refresh")
                .keyboardShortcut("r", modifiers: .command)
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    newThreadOpen = true
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .help("New chat")
                .keyboardShortcut("n", modifiers: .command)
            }
        }
        .sheet(isPresented: $newThreadOpen) {
            NewThreadSheet(isPresented: $newThreadOpen)
        }
        .alert("Rename chat", isPresented: Binding(
            get: { renamingSession != nil },
            set: { if !$0 { renamingSession = nil } },
        )) {
            TextField("Title", text: $renameDraft)
            Button("Save") {
                if let session = renamingSession {
                    Task { await store.renameThread(sessionId: session.sessionId, title: renameDraft) }
                }
                renamingSession = nil
            }
            Button("Cancel", role: .cancel) { renamingSession = nil }
        }
        .onAppCommand(.newThread) { newThreadOpen = true }
        .onAppCommand(.switchWorkspace) { router.switchWorkspace() }
        .onAppCommand(.refresh) {
            Task {
                await store.refreshDiscovery()
                await store.refreshPreviews()
                if let id = store.currentSessionId {
                    await store.pollNewMessages(channel: id)
                }
            }
        }
        // Auto-flip to the Inbox tab whenever the user navigates into a
        // routine session by any means (CLI deep link, keyboard, mobile),
        // and mark that session read on the way in.
        .onChange(of: store.currentSessionId) { _, newValue in
            guard let id = newValue,
                  let session = store.sessions.first(where: { $0.sessionId == id }),
                  session.isRoutineChannel else { return }
            if activeTab != .inbox { activeTab = .inbox }
            inboxRead.markRead(
                workspaceId: store.workspaceId,
                sessionId: id,
                timestamp: session.lastEventAt,
            )
        }
    }

    private var accountFooter: some View {
        HStack(spacing: 8) {
            avatarView
            VStack(alignment: .leading, spacing: 1) {
                Text(auth.user?.displayName ?? "")
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(1)
                Text(auth.user?.email ?? "")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            Button {
                auth.signOut()
            } label: {
                Image(systemName: "rectangle.portrait.and.arrow.right")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .help("Sign out")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private var avatarView: some View {
        let initial = (auth.user?.displayName.first ?? auth.user?.email.first).map { String($0).uppercased() } ?? "?"
        if let url = auth.user?.photoURL {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    avatarFallback(initial: initial)
                }
            }
            .frame(width: 24, height: 24)
            .clipShape(Circle())
        } else {
            avatarFallback(initial: initial)
                .frame(width: 24, height: 24)
        }
    }

    private func avatarFallback(initial: String) -> some View {
        ZStack {
            Circle().fill(Color.accentColor)
            Text(initial)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.white)
        }
    }

    private var tabPicker: some View {
        // Segmented picker carries an unread badge in the Inbox label so
        // the count is glanceable without committing pixels to a second
        // widget. SwiftUI's `.segmented` style happily renders a Text
        // composed via interpolation.
        let inboxLabel: String = inboxUnreadCount > 0
            ? "Inbox (\(inboxUnreadCount))"
            : "Inbox"
        return Picker("View", selection: $activeTab) {
            Text("Chats").tag(SidebarTab.chats)
            Text(inboxLabel).tag(SidebarTab.inbox)
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }

    #if os(macOS)
    private var workspaceHeader: some View {
        let name = store.workspace?.name ?? "Workspace"
        let slug = store.workspace?.slug ?? store.workspaceId
        return HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(name)
                    .font(.headline)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(slug)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer(minLength: 0)
            browserToggleButton
            Button {
                router.switchWorkspace()
            } label: {
                Image(systemName: "rectangle.stack")
                    .font(.system(size: 14, weight: .medium))
            }
            .buttonStyle(.plain)
            .help("Switch workspace")
            .keyboardShortcut("k", modifiers: [.command, .shift])
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    #endif

    /// Icon-only toggle for the workspace-scoped Browser Fabric viewer. Lives
    /// next to the switch-workspace button on macOS and in the trailing
    /// toolbar slot on iOS — both sit on the same row as the workspace name
    /// so the toggle reads as a workspace-level setting, not per-thread.
    private var browserToggleButton: some View {
        let enabled = store.workspace?.browserEnabled ?? false
        return Button {
            Task { await store.setBrowserEnabled(!enabled) }
        } label: {
            Image(systemName: enabled ? "safari.fill" : "safari")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(enabled ? Color.accentColor : Color.secondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(enabled ? "Disable browser panel" : "Enable browser panel")
        #if os(macOS)
        .help(enabled ? "Hide browser panel" : "Show browser panel when a session is live")
        #endif
        .disabled(store.workspace == nil)
    }

    @ViewBuilder
    private var list: some View {
        if store.isLoading && filteredSessions.isEmpty {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if visibleSessions.isEmpty {
            emptyState
        } else {
            List(selection: Binding<String?>(
                get: { store.currentSessionId },
                set: { id in store.selectSession(id) },
            )) {
                ForEach(visibleSessions) { session in
                    if session.isRoutineChannel {
                        RoutineThreadRow(
                            session: session,
                            lastMessage: store.lastMessageBySession[session.sessionId],
                            isUnread: inboxRead.isUnread(
                                workspaceId: store.workspaceId,
                                sessionId: session.sessionId,
                                lastEventAt: session.lastEventAt,
                            ),
                        )
                        .tag(session.sessionId)
                        #if !os(macOS)
                        .swipeActions(edge: .trailing) {
                            Button {
                                inboxRead.markRead(
                                    workspaceId: store.workspaceId,
                                    sessionId: session.sessionId,
                                    timestamp: session.lastEventAt,
                                )
                            } label: {
                                Label("Mark Read", systemImage: "envelope.open")
                            }
                            .tint(.blue)
                        }
                        #endif
                    } else {
                        ThreadRow(
                            session: session,
                            agents: store.agents,
                            lastMessage: store.lastMessageBySession[session.sessionId],
                        )
                        .tag(session.sessionId)
                        #if !os(macOS)
                        .swipeActions(edge: .leading) {
                            Button {
                                Task { await store.toggleStar(sessionId: session.sessionId) }
                            } label: {
                                Label(session.starred ? "Unstar" : "Star",
                                      systemImage: session.starred ? "star.slash" : "star")
                            }
                            .tint(.yellow)
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                Task { await store.setStatus(sessionId: session.sessionId, status: "deleted") }
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                            Button {
                                Task { await store.setStatus(sessionId: session.sessionId, status: "archived") }
                            } label: {
                                Label("Archive", systemImage: "archivebox")
                            }
                            .tint(.gray)
                        }
                        #endif
                        .contextMenu {
                            Button {
                                renamingSession = session
                                renameDraft = session.title
                            } label: {
                                Label("Rename…", systemImage: "pencil")
                            }
                            Button {
                                Task { await store.toggleStar(sessionId: session.sessionId) }
                            } label: {
                                Label(
                                    session.starred ? "Unstar" : "Star",
                                    systemImage: session.starred ? "star.slash" : "star",
                                )
                            }
                            Button {
                                Task { await store.setStatus(sessionId: session.sessionId, status: "archived") }
                            } label: {
                                Label("Archive", systemImage: "archivebox")
                            }
                            Divider()
                            Button(role: .destructive) {
                                Task { await store.setStatus(sessionId: session.sessionId, status: "deleted") }
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
            }
            .listStyle(.sidebar)
            .refreshable {
                await store.refreshDiscovery()
                await store.refreshPreviews()
                if let id = store.currentSessionId {
                    await store.pollNewMessages(channel: id)
                }
            }
        }
    }

    private var emptyState: some View {
        let isSearching = !searchText.trimmingCharacters(in: .whitespaces).isEmpty
        let isInbox = activeTab == .inbox && !isSearching
        let icon: String = {
            if isSearching { return "magnifyingglass" }
            return isInbox ? "tray" : "bubble.left.and.bubble.right"
        }()
        let title: String = {
            if isSearching { return "No matches" }
            return isInbox ? "Inbox is empty" : "No chats yet"
        }()
        let subtitle: String? = {
            if isSearching { return nil }
            if isInbox {
                return "Routine activity from your agents will appear here."
            }
            if store.onlineAgents.isEmpty {
                return "Connect an agent to start a conversation."
            }
            return nil
        }()
        return VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 40))
                .foregroundStyle(.tertiary)
            Text(title)
                .font(.headline)
                .foregroundStyle(.secondary)
            if let subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            } else if !isInbox && !isSearching {
                Text("Tap \(Image(systemName: "square.and.pencil")) to start one.")
                    .font(.subheadline)
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct ThreadRow: View {
    let session: Session
    let agents: [Agent]
    let lastMessage: Message?

    private var sessionAgents: [Agent] {
        if session.participants.isEmpty { return agents }
        return agents.filter { session.participants.contains($0.agentName) }
    }

    private var lastActivityLabel: String {
        if let ms = session.lastEventAt {
            return RelativeTime.format(Date(timeIntervalSince1970: TimeInterval(ms) / 1000.0))
        }
        return ""
    }

    private var previewLine: String {
        guard let message = lastMessage else {
            return sessionAgents.map(\.agentName).joined(separator: ", ")
        }
        let sender = message.isFromUser ? "You" : message.senderName
        let trimmed = message.content
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return sender }
        return "\(sender): \(trimmed)"
    }

    private var isAgentWorking: Bool {
        lastMessage?.isStatus == true && !(lastMessage?.isFromUser ?? true)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            AvatarStack(agents: sessionAgents)
                .frame(width: 36, height: 36)

            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    if session.starred {
                        Image(systemName: "star.fill")
                            .foregroundStyle(.yellow)
                            .font(.caption2)
                    }
                    Text(session.title)
                        .font(.body)
                        .lineLimit(1)
                    if isAgentWorking {
                        ProgressView()
                            .controlSize(.mini)
                    }
                    Spacer()
                    Text(lastActivityLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(previewLine)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .italic(lastMessage?.isStatus == true)
            }
        }
        .padding(.vertical, 4)
    }
}

/// Row variant rendered inside the Inbox tab. Shows the agent name (the
/// bit after `routines:`) with a calendar icon, the last activity time,
/// the most recent fire's preview line, and an unread dot in the leading
/// gutter when the session has new activity since it was last opened.
private struct RoutineThreadRow: View {
    let session: Session
    let lastMessage: Message?
    let isUnread: Bool

    private var agentName: String { session.routineAgentName ?? session.title }

    private var lastActivityLabel: String {
        if let ms = session.lastEventAt {
            return RelativeTime.format(Date(timeIntervalSince1970: TimeInterval(ms) / 1000.0))
        }
        return ""
    }

    private var previewLine: String {
        guard let message = lastMessage else { return "" }
        let sender = message.isFromUser ? "You" : message.senderName
        let trimmed = message.content
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return sender }
        return "\(sender): \(trimmed)"
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            // Fixed-width unread gutter so rows align whether dotted or not.
            ZStack {
                if isUnread {
                    Circle()
                        .fill(Color.accentColor)
                        .frame(width: 8, height: 8)
                }
            }
            .frame(width: 10)
            .padding(.top, 14)

            Image(systemName: "calendar.badge.clock")
                .font(.system(size: 18))
                .foregroundStyle(.secondary)
                .frame(width: 32, height: 32)

            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(agentName)
                        .font(.body)
                        .fontWeight(isUnread ? .semibold : .regular)
                        .lineLimit(1)
                    Spacer()
                    Text(lastActivityLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if !previewLine.isEmpty {
                    Text(previewLine)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

struct AvatarStack: View {
    let agents: [Agent]
    var max: Int = 3

    var body: some View {
        let shown = Array(agents.prefix(max))
        if shown.count == 1, let agent = shown.first {
            AvatarTile(agent: agent, size: 32, fontSize: 11)
        } else if shown.count > 1 {
            ZStack {
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, agent in
                    AvatarTile(agent: agent, size: 22, fontSize: 8)
                        .overlay(Circle().stroke(PlatformColors.windowBackground, lineWidth: 2))
                        .offset(x: CGFloat(index) * -8, y: 0)
                }
            }
            .frame(width: 36, alignment: .center)
        } else {
            Circle()
                .fill(.gray.opacity(0.2))
                .frame(width: 32, height: 32)
        }
    }
}

private struct AvatarTile: View {
    let agent: Agent
    let size: CGFloat
    let fontSize: CGFloat

    var body: some View {
        Circle()
            .fill(AgentPalette.color(for: agent.agentName))
            .frame(width: size, height: size)
            .overlay(
                Text(agent.initials)
                    .font(.system(size: fontSize, weight: .bold))
                    .foregroundStyle(.white),
            )
            .overlay(alignment: .bottomTrailing) {
                if agent.isOnline {
                    Circle()
                        .fill(.green)
                        .frame(width: size * 0.28, height: size * 0.28)
                        .overlay(Circle().stroke(PlatformColors.windowBackground, lineWidth: 1.5))
                        .offset(x: 1, y: 1)
                }
            }
    }
}

enum PlatformColors {
    static var windowBackground: Color {
        #if os(macOS)
        Color(NSColor.windowBackgroundColor)
        #else
        Color(UIColor.systemBackground)
        #endif
    }
}
