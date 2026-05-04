import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

struct ThreadListView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(AppRouter.self) private var router

    @State private var searchText: String = ""
    @State private var newThreadOpen: Bool = false
    @State private var renamingSession: Session?
    @State private var renameDraft: String = ""

    private var filteredSessions: [Session] {
        let sessions = store.activeSessions
        let q = searchText.trimmingCharacters(in: .whitespaces).lowercased()
        if q.isEmpty { return sessions }
        return sessions.filter { $0.title.lowercased().contains(q) }
    }

    var body: some View {
        VStack(spacing: 0) {
            list
        }
        .navigationTitle(store.workspace?.name ?? "Workspace")
        #if os(macOS)
        .navigationSubtitle(store.workspace?.slug ?? store.workspaceId)
        #endif
        .searchable(text: $searchText, placement: .toolbar, prompt: "Search")
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button {
                    router.switchWorkspace()
                } label: {
                    Image(systemName: "rectangle.stack")
                }
                .help("Switch workspace")
                .keyboardShortcut("k", modifiers: [.command, .shift])
            }
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
                .help("New thread")
                .keyboardShortcut("n", modifiers: .command)
            }
        }
        .sheet(isPresented: $newThreadOpen) {
            NewThreadSheet(isPresented: $newThreadOpen)
        }
        .alert("Rename thread", isPresented: Binding(
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
    }

    @ViewBuilder
    private var list: some View {
        if store.isLoading && filteredSessions.isEmpty {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if filteredSessions.isEmpty {
            VStack(spacing: 12) {
                Image(systemName: searchText.isEmpty ? "bubble.left.and.bubble.right" : "magnifyingglass")
                    .font(.system(size: 40))
                    .foregroundStyle(.tertiary)
                Text(searchText.isEmpty ? "No threads yet" : "No matches")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                if searchText.isEmpty {
                    Text(store.onlineAgents.isEmpty
                         ? "Connect an agent to start a conversation."
                         : "Tap \(Image(systemName: "square.and.pencil")) to start one.")
                        .font(.subheadline)
                        .foregroundStyle(.tertiary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List(selection: Binding<String?>(
                get: { store.currentSessionId },
                set: { id in store.selectSession(id) },
            )) {
                ForEach(filteredSessions) { session in
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
