import Foundation
import Observation

/// Per-session message page state. Tracks cursors so we can do incremental polling forward
/// (only fetch new messages) and load older messages on scroll-up.
struct ChannelMessages: Sendable {
    var messages: [Message] = []
    var oldestId: String?
    var newestId: String?
    /// True when the backend says there are still older messages we haven't fetched.
    var hasOlder: Bool = false
    var loadingOlder: Bool = false
    /// True while the initial history fetch is in flight. Distinct from
    /// `loadingOlder` — drives the chat view's "loading…" placeholder vs.
    /// the empty-thread "say hi" copy.
    var loadingHistory: Bool = false
    /// Increments whenever the messages array is bulk-replaced (initial load, session switch).
    /// Drives scroll-to-bottom in the chat view.
    var generation: Int = 0
}

/// Central app state for a single connected workspace. Created once we have a workspace ID + token.
@MainActor
@Observable
final class WorkspaceStore {
    let workspaceId: String
    let token: String
    private let api: WorkspaceAPI

    var workspace: Workspace?
    var agents: [Agent] = []
    var sessions: [Session] = []
    var currentSessionId: String?
    /// Per-session message page state with cursor info.
    var pagesBySession: [String: ChannelMessages] = [:]
    /// Last-message preview per session — used by the thread list rows.
    var lastMessageBySession: [String: Message] = [:]
    var isLoading: Bool = true
    var lastError: String?

    private var pollTask: Task<Void, Never>?
    private var messagePollTask: Task<Void, Never>?

    /// How many messages to load at a time. Matches the React app (50 initial / 30 older).
    private let initialPageSize = 50
    private let olderPageSize = 30

    init(workspaceId: String, token: String, baseURL: URL) {
        self.workspaceId = workspaceId
        self.token = token
        self.api = WorkspaceAPI(baseURL: baseURL)
        logInfo("workspace", "store init id=\(workspaceId) apiBaseURL=\(baseURL.absoluteString)")
    }

    func bootstrap() async {
        await api.configure(workspaceId: workspaceId, token: token)
        await refreshDiscovery()
        await refreshPreviews()
        if currentSessionId == nil, let first = activeSessions.first {
            currentSessionId = first.sessionId
            await loadHistory(channel: first.sessionId)
        }
        isLoading = false
        startPolling()
    }

    /// Stop background tasks. Called when the user switches workspaces or signs out.
    func teardown() {
        pollTask?.cancel()
        messagePollTask?.cancel()
        pollTask = nil
        messagePollTask = nil
    }

    // MARK: - Derived state

    var activeSessions: [Session] {
        sessions
            .filter { $0.status != "deleted" && $0.status != "archived" }
            .sorted { lhs, rhs in
                if lhs.starred != rhs.starred { return lhs.starred }
                return (lhs.lastEventAt ?? 0) > (rhs.lastEventAt ?? 0)
            }
    }

    var currentSession: Session? {
        sessions.first { $0.sessionId == currentSessionId }
    }

    var currentMessages: [Message] {
        guard let id = currentSessionId else { return [] }
        return pagesBySession[id]?.messages ?? []
    }

    var currentPage: ChannelMessages? {
        guard let id = currentSessionId else { return nil }
        return pagesBySession[id]
    }

    var onlineAgents: [Agent] { agents.filter(\.isOnline) }

    /// True when any session's most recent message is a pending status (agent working) — drives
    /// adaptive polling speed.
    var hasActiveAgents: Bool {
        for (_, message) in lastMessageBySession {
            if message.isStatus && !message.isFromUser { return true }
        }
        return false
    }

    // MARK: - Actions

    func selectSession(_ sessionId: String?) {
        guard sessionId != currentSessionId else { return }
        currentSessionId = sessionId
        // nil arrives when iPhone's compact NavigationSplitView pops the detail —
        // accept it so re-tapping the same row re-pushes.
        guard let sessionId else { return }
        // If we don't have any messages cached yet, load history; otherwise rely on polling
        // to catch us up (cached page is shown immediately).
        let needsHistory = pagesBySession[sessionId]?.messages.isEmpty != false
        if needsHistory {
            Task { await loadHistory(channel: sessionId) }
        } else {
            Task { await pollNewMessages(channel: sessionId) }
        }
    }

    func refreshDiscovery() async {
        do {
            let discovery = try await api.discover()
            self.agents = discovery.agents.map { $0.toAgent() }
            self.sessions = discovery.channels.map { $0.toSession(workspaceId: workspaceId) }
            // Drop stale current selection if the session no longer exists
            if let id = currentSessionId, !sessions.contains(where: { $0.sessionId == id }) {
                currentSessionId = activeSessions.first?.sessionId
                if let id = currentSessionId {
                    Task { await self.loadHistory(channel: id) }
                }
            }
            // Also refresh workspace metadata in the background — non-blocking.
            if workspace == nil {
                Task { try? await self.refreshWorkspaceMetadata() }
            }
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Fetch the latest message per channel — populates `lastMessageBySession` for thread previews.
    func refreshPreviews() async {
        do {
            let latest = try await api.latestPerChannel()
            var batch: [String: Message] = [:]
            for (channel, event) in latest {
                batch[channel] = event.toMessage()
            }
            for (channel, message) in batch {
                if let existing = lastMessageBySession[channel],
                   existing.timestamp > message.timestamp {
                    continue
                }
                lastMessageBySession[channel] = message
            }
        } catch {
            // Non-critical — silently keep existing previews
        }
    }

    private func refreshWorkspaceMetadata() async throws {
        let ws = try await api.getWorkspace()
        self.workspace = ws
        // Update the persisted name on the history entry. touch() preserves the entry's
        // existing appURL / apiURL pair when they're not passed in, which is what we want.
        WorkspaceHistory.shared.touch(workspaceId: workspaceId, token: token, name: ws.name)
        // If this is the active workspace, mirror the now-updated history entry into
        // `currentWorkspace` so a future launch sees the right URL pair (and the right name).
        if let current = WorkspaceHistory.shared.current(), current.workspaceId == workspaceId,
           let updated = WorkspaceHistory.shared.entries().first(where: { $0.workspaceId == workspaceId }) {
            WorkspaceHistory.shared.setCurrent(updated)
            logInfo("workspace", "metadata refreshed — name=\(ws.name) apiURL=\(updated.apiURL ?? "nil")")
        }
    }

    // MARK: - Message pagination

    /// Initial / on-session-change load. Fetches the most recent page of messages and replaces
    /// any existing cache for this channel. Bumps generation so the chat view scrolls to bottom.
    func loadHistory(channel: String) async {
        // Publish "loading" before the await so the chat view can show a
        // spinner instead of the empty-thread "say hi" placeholder during the
        // network round-trip — without this the user sees a blank thread that
        // looks identical to an empty one.
        var page = pagesBySession[channel] ?? ChannelMessages()
        page.loadingHistory = true
        pagesBySession[channel] = page

        do {
            let batch = try await api.loadMessages(
                channel: channel,
                sort: "desc",
                limit: initialPageSize,
            )
            page.messages = batch.messages
            page.oldestId = batch.oldestId
            page.newestId = batch.newestId
            page.hasOlder = batch.hasMore
            page.loadingHistory = false
            page.generation += 1
            pagesBySession[channel] = page
            if let last = batch.messages.last {
                lastMessageBySession[channel] = last
            }
            logInfo("history", "loaded \(batch.messages.count) for \(channel) hasOlder=\(batch.hasMore) newestId=\(batch.newestId ?? "nil")")
            lastError = nil
        } catch {
            page.loadingHistory = false
            pagesBySession[channel] = page
            logError("history", "channel=\(channel) failed: \(error.localizedDescription)")
            lastError = error.localizedDescription
        }
    }

    /// Forward poll — fetch only messages newer than the cached `newestId`. Used by the
    /// background polling loop and after sending a message.
    ///
    /// TODO(notifications): when `newOnes` contains an agent message AND
    /// (`channel != currentSessionId` OR `scenePhase != .active`), schedule a
    /// `UNUserNotificationCenter` local notification (title = sender, body = trimmed
    /// content). Suppress when the thread is muted in WorkspaceHistory. Update an
    /// unread-count map and badge the dock / app icon accordingly. See README ▸ TODO.
    func pollNewMessages(channel: String) async {
        var page = pagesBySession[channel] ?? ChannelMessages()
        do {
            var keepGoing = true
            var totalNew = 0
            while keepGoing {
                let batch = try await api.loadMessages(
                    channel: channel,
                    after: page.newestId,
                    sort: "asc",
                    limit: 200,
                )
                if batch.messages.isEmpty {
                    keepGoing = false
                    break
                }
                let existingIds = Set(page.messages.map(\.messageId))
                let newOnes = batch.messages.filter { !existingIds.contains($0.messageId) }
                if newOnes.isEmpty {
                    keepGoing = false
                    break
                }
                // Reconcile optimistic placeholders against the real human message
                var droppedOptimistic = 0
                for new in newOnes where new.isFromUser {
                    let before = page.messages.count
                    page.messages.removeAll { msg in
                        msg.messageId.hasPrefix("optimistic-")
                            && msg.isFromUser
                            && msg.content == new.content
                            && abs(msg.timestamp - new.timestamp) < 30_000
                    }
                    droppedOptimistic += before - page.messages.count
                }
                page.messages.append(contentsOf: newOnes)
                if let last = newOnes.last { page.newestId = last.messageId }
                if let last = newOnes.last { lastMessageBySession[channel] = last }
                totalNew += newOnes.count
                if droppedOptimistic > 0 {
                    logInfo("poll", "dropped \(droppedOptimistic) optimistic placeholder(s)")
                }
                keepGoing = batch.hasMore
            }
            pagesBySession[channel] = page
            if totalNew > 0 {
                logInfo("poll", "+\(totalNew) new in \(channel) (newestId now \(page.newestId ?? "nil"))")
            }
            lastError = nil
        } catch {
            logError("poll", "channel=\(channel) failed: \(error.localizedDescription)")
            lastError = error.localizedDescription
        }
    }

    /// Load an older page when the user scrolls past the top. Prepends to the cached array
    /// without bumping `generation`, so the chat view doesn't auto-scroll on this load.
    func loadOlderMessages(channel: String) async {
        guard var page = pagesBySession[channel],
              page.hasOlder, !page.loadingOlder,
              let oldestId = page.oldestId else { return }
        page.loadingOlder = true
        pagesBySession[channel] = page
        defer {
            if var p = pagesBySession[channel] { p.loadingOlder = false; pagesBySession[channel] = p }
        }
        do {
            let batch = try await api.loadMessages(
                channel: channel,
                before: oldestId,
                sort: "desc",
                limit: olderPageSize,
            )
            guard var p = pagesBySession[channel] else { return }
            if batch.messages.isEmpty {
                p.hasOlder = false
                pagesBySession[channel] = p
                return
            }
            let existingIds = Set(p.messages.map(\.messageId))
            let newOnes = batch.messages.filter { !existingIds.contains($0.messageId) }
            p.messages.insert(contentsOf: newOnes, at: 0)
            if let first = batch.messages.first { p.oldestId = first.messageId }
            p.hasOlder = batch.hasMore
            pagesBySession[channel] = p
        } catch {
            lastError = error.localizedDescription
        }
    }

    func sendMessage(_ content: String, attachments: [PendingAttachment] = []) async {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty || !attachments.isEmpty else {
            logWarn("send", "ignored — empty content and no attachments")
            return
        }
        guard let channel = currentSessionId else {
            logWarn("send", "ignored — no current session")
            return
        }

        let preview = trimmed.count > 60 ? String(trimmed.prefix(60)) + "…" : trimmed
        logInfo("send", "→ channel=\(channel) chars=\(trimmed.count) attachments=\(attachments.count) text=\"\(preview)\"")

        // Optimistic insert *before* the network request so the bubble appears instantly.
        // Pending attachments are shown as 📎 lines so the user sees them immediately.
        let optimisticContent: String = {
            var parts: [String] = []
            if !trimmed.isEmpty { parts.append(trimmed) }
            for a in attachments { parts.append("📎 \(a.filename) — uploading…") }
            return parts.joined(separator: "\n\n")
        }()
        let optimisticId = "optimistic-\(Int(Date().timeIntervalSince1970 * 1000))"
        let optimistic = Message(
            messageId: optimisticId,
            sessionId: channel,
            senderType: "human",
            senderName: "You",
            content: optimisticContent,
            mentions: [],
            messageType: "chat",
            timestamp: Int64(Date().timeIntervalSince1970 * 1000),
        )
        var page = pagesBySession[channel] ?? ChannelMessages()
        page.messages.append(optimistic)
        page.generation += 1
        pagesBySession[channel] = page
        logInfo("send", "inserted optimistic id=\(optimisticId)")

        do {
            // Upload attachments first; collect markdown links to splice into the message.
            var attachmentLinks: [String] = []
            for a in attachments {
                let uploaded = try await api.uploadFile(
                    channel: channel,
                    filename: a.filename,
                    contentType: a.contentType,
                    data: a.data,
                )
                let url = await api.downloadURL(fileId: uploaded.id)
                attachmentLinks.append("📎 [\(uploaded.filename)](\(url.absoluteString))")
                logInfo("send", "uploaded id=\(uploaded.id) name=\(uploaded.filename) size=\(uploaded.size)")
            }

            let finalContent: String = {
                var parts: [String] = []
                if !trimmed.isEmpty { parts.append(trimmed) }
                parts.append(contentsOf: attachmentLinks)
                return parts.joined(separator: "\n\n")
            }()

            let event = try await api.sendMessage(channel: channel, content: finalContent)
            logInfo("send", "✓ backend ack id=\(event.id) ts=\(event.timestamp)")
            lastError = nil
            Task { [weak self] in
                for delayMs in [600, 1500, 3500] {
                    try? await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
                    guard let self else { return }
                    await self.pollNewMessages(channel: channel)
                }
            }
        } catch {
            logError("send", "✗ failed: \(error.localizedDescription)")
            if var p = pagesBySession[channel] {
                p.messages.removeAll { $0.messageId == optimisticId }
                pagesBySession[channel] = p
            }
            lastError = error.localizedDescription
        }
    }

    func renameThread(sessionId: String, title: String) async {
        let trimmed = title.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty,
              let index = sessions.firstIndex(where: { $0.sessionId == sessionId }) else { return }
        let prevTitle = sessions[index].title
        sessions[index].title = trimmed
        do {
            try await api.updateChannel(channelName: sessionId, title: trimmed)
        } catch {
            sessions[index].title = prevTitle
            lastError = error.localizedDescription
        }
    }

    func toggleStar(sessionId: String) async {
        guard let session = sessions.first(where: { $0.sessionId == sessionId }) else { return }
        let newStarred = !session.starred
        if let index = sessions.firstIndex(where: { $0.sessionId == sessionId }) {
            sessions[index].starred = newStarred
        }
        do {
            try await api.updateChannel(channelName: sessionId, starred: newStarred)
        } catch {
            if let index = sessions.firstIndex(where: { $0.sessionId == sessionId }) {
                sessions[index].starred = !newStarred
            }
            lastError = error.localizedDescription
        }
    }

    func setStatus(sessionId: String, status: String) async {
        guard let index = sessions.firstIndex(where: { $0.sessionId == sessionId }) else { return }
        let prevStatus = sessions[index].status
        sessions[index].status = status
        if status == "deleted" || status == "archived", currentSessionId == sessionId {
            currentSessionId = activeSessions.first?.sessionId
            if let id = currentSessionId {
                Task { await self.loadHistory(channel: id) }
            }
        }
        do {
            try await api.updateChannel(channelName: sessionId, status: status)
        } catch {
            sessions[index].status = prevStatus
            lastError = error.localizedDescription
        }
    }

    func createThread(master: String, participants: [String]) async {
        do {
            let session = try await api.createChannel(master: master, participants: participants)
            sessions.insert(session, at: 0)
            currentSessionId = session.sessionId
            await loadHistory(channel: session.sessionId)
        } catch {
            lastError = error.localizedDescription
        }
    }

    // MARK: - Files (used by ContentSidebar)

    /// Fetch a page of workspace files for the sidebar. Returns the raw
    /// response so the caller can decide whether to merge / paginate.
    /// Errors are surfaced as a thrown error rather than via `lastError` so
    /// the sidebar can render its own inline failure state instead of a
    /// banner over the whole chat.
    func listFiles(channel: String? = nil, limit: Int = 100) async throws -> [WorkspaceFile] {
        let resp = try await api.listFiles(channel: channel, limit: limit)
        return resp.files
    }

    /// `URLRequest` for downloading a file's bytes, with the workspace token
    /// pre-attached. Used by `AuthorizedAsyncImage` since `AsyncImage`
    /// doesn't accept custom headers.
    func authorizedFileDownloadRequest(fileId: String) async -> URLRequest {
        await api.authorizedDownloadRequest(fileId: fileId)
    }

    /// Look up a single file's metadata. Used by the sidebar detail view when
    /// the user lands on a file via a chat chip — we don't always have the
    /// full file row cached client-side.
    func fetchFileInfo(fileId: String) async throws -> WorkspaceFile {
        try await api.getFileInfo(fileId: fileId)
    }

    // MARK: - Polling

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let interval = await self.hasActiveAgents ? 5 : 15
                try? await Task.sleep(for: .seconds(interval))
                await self.refreshDiscovery()
                await self.refreshPreviews()
            }
        }
        messagePollTask?.cancel()
        messagePollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let interval: Double = await self.hasActiveAgents ? 1.5 : 3
                try? await Task.sleep(for: .seconds(interval))
                if let id = self.currentSessionId {
                    await self.pollNewMessages(channel: id)
                }
            }
        }
    }
}
