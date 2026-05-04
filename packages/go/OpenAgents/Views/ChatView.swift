import SwiftUI

struct ChatView: View {
    @Environment(WorkspaceStore.self) private var store

    @State private var draftsBySession: [String: String] = [:]
    @FocusState private var inputFocused: Bool

    private var draft: Binding<String> {
        Binding(
            get: { draftsBySession[store.currentSessionId ?? ""] ?? "" },
            set: { draftsBySession[store.currentSessionId ?? ""] = $0 },
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            if let error = store.lastError {
                ErrorBanner(message: error) { store.lastError = nil }
            }
            if let session = store.currentSession {
                #if os(iOS)
                // On iPhone the nav bar (provided by the collapsed NavigationSplitView)
                // already shows the title — drop the in-content header to save vertical
                // room for messages.
                #else
                header(for: session)
                Divider()
                #endif
                messageList(for: session)
                Divider()
                inputBar
            } else {
                placeholder
            }
        }
        .onChange(of: store.currentSessionId) { _, _ in
            inputFocused = true
        }
        #if os(macOS)
        .background(Color(.controlBackgroundColor))
        #else
        .navigationTitle(store.currentSession?.title ?? "")
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    // MARK: - Sections

    private func header(for session: Session) -> some View {
        let sessionAgents = store.agents.filter {
            session.participants.isEmpty || session.participants.contains($0.agentName)
        }
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(session.title)
                    .font(.headline)
                if !sessionAgents.isEmpty {
                    Text(sessionAgents.map(\.agentName).joined(separator: ", "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            Spacer()
            if !sessionAgents.isEmpty {
                AvatarStack(agents: sessionAgents)
                    .frame(width: 36, height: 36)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private func messageList(for session: Session) -> some View {
        let messages = store.currentMessages
        let page = store.currentPage
        let groups = MessageGrouper.group(messages)
        let lastChatMessageId = messages.last { !$0.isStatus }?.messageId

        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 6) {
                    // Top anchor: when this comes into view (user scrolled to top), load more.
                    if page?.hasOlder == true {
                        loadOlderTrigger(channel: session.sessionId)
                    } else if !messages.isEmpty {
                        // Subtle "you're at the start" marker
                        Text("Beginning of conversation")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                    }

                    if messages.isEmpty && page?.loadingOlder != true {
                        Text("No messages yet — say hi.")
                            .foregroundStyle(.secondary)
                            .padding(.top, 60)
                    }

                    ForEach(Array(groups.enumerated()), id: \.offset) { index, group in
                        switch group {
                        case .chat(let message):
                            MessageBubble(
                                message: message,
                                showSenderLabel: shouldShowSenderLabel(for: message, groupIndex: index, in: groups),
                            )
                            .id(message.id)
                        case .steps(let stepMessages):
                            IntermediateStepsView(
                                steps: stepMessages,
                                isActive: index == groups.count - 1
                                    && (lastChatMessageId == nil
                                        || (stepMessages.last?.timestamp ?? 0) > (messages.first { $0.messageId == lastChatMessageId }?.timestamp ?? 0)),
                            )
                            .id("steps-\(stepMessages.first?.messageId ?? "")")
                        }
                    }

                    // Bottom anchor — used to scroll to the latest message
                    Color.clear
                        .frame(height: 1)
                        .id("bottom-anchor")
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            #if os(iOS)
            // Drag the messages down to dismiss the keyboard — standard iOS chat-app gesture.
            .scrollDismissesKeyboard(.interactively)
            #endif
            // Bulk replace (initial load, session switch, message sent) → scroll to bottom.
            // Forward poll just appending new messages doesn't bump generation.
            .onChange(of: page?.generation ?? 0) { _, _ in
                DispatchQueue.main.async {
                    proxy.scrollTo("bottom-anchor", anchor: .bottom)
                }
            }
            // New trailing message arriving from poll → scroll to bottom (gentle).
            .onChange(of: messages.last?.id) { _, _ in
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo("bottom-anchor", anchor: .bottom)
                }
            }
            // First appearance — start at the bottom.
            .onAppear {
                proxy.scrollTo("bottom-anchor", anchor: .bottom)
            }
        }
    }

    /// Invisible-ish progress row at the top of the message list. When SwiftUI lays it out
    /// (i.e. the user has scrolled near the top), it triggers loading the next older page.
    private func loadOlderTrigger(channel: String) -> some View {
        HStack(spacing: 8) {
            ProgressView()
                .controlSize(.small)
            Text("Loading older messages…")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .task(id: channel) {
            // Tiny delay so this only fires when the user has dwelled at the top, not just
            // brushed past it on initial layout.
            try? await Task.sleep(nanoseconds: 200_000_000)
            await store.loadOlderMessages(channel: channel)
        }
    }

    private var inputBar: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("iMessage", text: draft, axis: .vertical)
                .textFieldStyle(.plain)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
                .focused($inputFocused)
                .lineLimit(1...6)
                .onSubmit(send)
            Button(action: send) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(.tint)
            }
            .buttonStyle(.plain)
            .disabled(draft.wrappedValue.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private var placeholder: some View {
        VStack(spacing: 12) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 48))
                .foregroundStyle(.tertiary)
            Text("Select a thread")
                .font(.title3)
                .foregroundStyle(.secondary)
            Text("Choose a thread from the list or create a new one.")
                .font(.subheadline)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func send() {
        let text = draft.wrappedValue
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            logWarn("ui", "send() ignored — empty draft")
            return
        }
        logInfo("ui", "send() invoked, chars=\(trimmed.count)")
        draft.wrappedValue = ""
        Task { await store.sendMessage(trimmed) }
    }

    /// Show the sender label only on the first chat message in a run from the same agent.
    private func shouldShowSenderLabel(for message: Message, groupIndex: Int, in groups: [MessageGroup]) -> Bool {
        if message.isFromUser { return false }
        guard groupIndex > 0 else { return true }
        // Look back through prior groups for the most recent chat message
        for prior in (0..<groupIndex).reversed() {
            if case .chat(let prev) = groups[prior] {
                return prev.senderName != message.senderName
            }
            // .steps groups don't reset sender grouping
        }
        return true
    }
}

// MARK: - Message grouping

enum MessageGroup {
    case chat(Message)
    case steps([Message])
}

enum MessageGrouper {
    /// Mirrors React's groupMessages — collapses consecutive status/thinking messages into
    /// a single steps block so they render under one indented border.
    static func group(_ messages: [Message]) -> [MessageGroup] {
        var groups: [MessageGroup] = []
        var bufferedSteps: [Message] = []

        func flush() {
            if !bufferedSteps.isEmpty {
                groups.append(.steps(bufferedSteps))
                bufferedSteps = []
            }
        }

        for message in messages {
            if message.isStatus {
                bufferedSteps.append(message)
            } else {
                flush()
                groups.append(.chat(message))
            }
        }
        flush()
        return groups
    }
}

private struct CodeBlockView: View {
    let language: String?
    let content: String
    /// Whether this code block is inside an agent (light) bubble vs. user (blue) bubble.
    let onLightBubble: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let language, !language.isEmpty {
                Text(language)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                Text(content)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(onLightBubble ? Color.primary : Color.white)
                    .padding(8)
                    .textSelection(.enabled)
            }
        }
        .background(onLightBubble ? Color.black.opacity(0.06) : Color.white.opacity(0.18))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

private struct ErrorBanner: View {
    let message: String
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            Text(message)
                .font(.caption)
                .foregroundStyle(.primary)
                .lineLimit(2)
            Spacer()
            Button {
                onDismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.orange.opacity(0.12))
    }
}

private struct MessageBubble: View {
    let message: Message
    var showSenderLabel: Bool = true

    var body: some View {
        HStack {
            if message.isFromUser {
                Spacer(minLength: 60)
                bubble(alignment: .trailing)
            } else {
                bubble(alignment: .leading)
                Spacer(minLength: 60)
            }
        }
    }

    @ViewBuilder
    private func bubble(alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 2) {
            if !message.isFromUser && showSenderLabel {
                Text(message.senderName)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.leading, 12)
            }
            VStack(alignment: alignment, spacing: 6) {
                ForEach(Array(MarkdownSegmenter.segments(in: message.content).enumerated()), id: \.offset) { _, segment in
                    switch segment {
                    case .prose(let text):
                        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                        if !trimmed.isEmpty {
                            // No explicit frame — Text sizes to its natural width within the
                            // HStack's available space (Spacer(minLength: 60) caps it). Short
                            // messages hug, long ones wrap. Matches iMessage bubble sizing.
                            Text(.init(trimmed))
                                .textSelection(.enabled)
                                .multilineTextAlignment(alignment == .trailing ? .trailing : .leading)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    case .code(let lang, let code):
                        CodeBlockView(language: lang, content: code, onLightBubble: !message.isFromUser)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(bubbleBackground)
            .foregroundStyle(message.isFromUser ? .white : .primary)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(.black.opacity(message.isFromUser ? 0 : 0.06), lineWidth: 0.5),
            )
        }
    }

    private var bubbleBackground: Color {
        message.isFromUser ? Color.blue : Color.gray.opacity(0.18)
    }
}
