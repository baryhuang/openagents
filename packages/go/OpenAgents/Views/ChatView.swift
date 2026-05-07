import SwiftUI
import UniformTypeIdentifiers
#if os(macOS)
import AppKit
#else
import PhotosUI
#endif

struct ChatView: View {
    @Environment(WorkspaceStore.self) private var store

    @State private var draftsBySession: [String: String] = [:]
    @State private var pendingAttachments: [PendingAttachment] = []
    @FocusState private var inputFocused: Bool

    /// Manual override for input-bar height (in points). Drag handle adjusts this.
    /// Default starts at the single-line height; user can drag up to ~half of the
    /// chat view height (see `maxInputHeight`).
    @State private var inputHeight: CGFloat = ChatView.defaultInputHeight
    @State private var dragStartHeight: CGFloat?
    /// Total chat-view height, captured via a preference key. Used to clamp resize
    /// so the input never grows past 50% of the viewport.
    @State private var chatHeight: CGFloat = 0

    #if os(iOS)
    @State private var showingPhotoPicker = false
    @State private var photoPickerItems: [PhotosPickerItem] = []
    @State private var showingFileImporter = false
    #endif

    private static let defaultInputHeight: CGFloat = 44
    private static let minInputHeight: CGFloat = 36

    private var maxInputHeight: CGFloat {
        max(Self.minInputHeight + 1, chatHeight * 0.5)
    }

    private var draft: Binding<String> {
        Binding(
            get: { draftsBySession[store.currentSessionId ?? ""] ?? "" },
            set: { draftsBySession[store.currentSessionId ?? ""] = $0 },
        )
    }

    private var canSend: Bool {
        !draft.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !pendingAttachments.isEmpty
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
        .background(
            GeometryReader { geo in
                Color.clear.preference(key: ChatHeightKey.self, value: geo.size.height)
            },
        )
        .onPreferenceChange(ChatHeightKey.self) { newValue in
            chatHeight = newValue
            // If a previous drag left us above the new viewport's allowance, clamp down.
            if inputHeight > maxInputHeight {
                inputHeight = maxInputHeight
            }
        }
        .onChange(of: store.currentSessionId) { _, _ in
            inputFocused = true
            // Drafts are per-session, but pending uploads aren't — clear them on switch.
            pendingAttachments.removeAll()
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

    // MARK: - Input bar

    private var inputBar: some View {
        VStack(spacing: 0) {
            dragHandle

            if !pendingAttachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(pendingAttachments) { attachment in
                            AttachmentChip(attachment: attachment) {
                                pendingAttachments.removeAll { $0.id == attachment.id }
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                }
            }

            HStack(alignment: .bottom, spacing: 8) {
                paperclipControl

                inputField

                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(canSend ? Color.accentColor : Color.gray.opacity(0.4))
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        #if os(iOS)
        // iPhone/iPad: paperclip is a Menu offering Photos (PhotosPicker) and
        // Files (.fileImporter). Each option drives the same PendingAttachment
        // chip + multipart upload pipeline as macOS.
        .photosPicker(
            isPresented: $showingPhotoPicker,
            selection: $photoPickerItems,
            maxSelectionCount: 10,
            matching: .images,
            photoLibrary: .shared(),
        )
        .onChange(of: photoPickerItems) { _, items in
            guard !items.isEmpty else { return }
            let picked = items
            photoPickerItems = []
            Task { await ingestPhotoPickerItems(picked) }
        }
        .fileImporter(
            isPresented: $showingFileImporter,
            allowedContentTypes: [.item],
            allowsMultipleSelection: true,
        ) { result in
            if case .success(let urls) = result {
                for url in urls { ingestFileURL(url) }
            }
        }
        #endif
    }

    /// Paperclip trigger.
    /// - macOS: single Button → `NSOpenPanel`.
    /// - iOS: `Menu` with two options — Photo Library and Files.
    @ViewBuilder
    private var paperclipControl: some View {
        let label = Image(systemName: "paperclip")
            .font(.system(size: 18, weight: .regular))
            .foregroundStyle(.secondary)
            .frame(width: 32, height: 32)

        #if os(macOS)
        Button(action: pickFiles) { label }
            .buttonStyle(.plain)
            .help("Attach files")
        #else
        Menu {
            Button {
                showingPhotoPicker = true
            } label: {
                Label("Photo Library", systemImage: "photo.on.rectangle.angled")
            }
            Button {
                showingFileImporter = true
            } label: {
                Label("Files", systemImage: "folder")
            }
        } label: {
            label
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        #endif
    }

    /// Thin grab bar above the attachment row. Drag up to grow the input toward
    /// half the chat height; drag down to shrink back to single-line.
    private var dragHandle: some View {
        let handle = Capsule()
            .fill(Color.gray.opacity(0.35))
            .frame(width: 32, height: 3)

        return Color.clear
            .frame(height: 10)
            .overlay(handle)
            .contentShape(Rectangle())
            #if os(macOS)
            .onHover { inside in
                if inside {
                    NSCursor.resizeUpDown.push()
                } else {
                    NSCursor.pop()
                }
            }
            #endif
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        if dragStartHeight == nil { dragStartHeight = inputHeight }
                        let proposed = (dragStartHeight ?? inputHeight) - value.translation.height
                        inputHeight = max(Self.minInputHeight, min(maxInputHeight, proposed))
                    }
                    .onEnded { _ in dragStartHeight = nil },
            )
    }

    /// TextEditor with a manual placeholder. We use TextEditor (not TextField) so the
    /// height can be controlled directly by `inputHeight`; the editor scrolls internally
    /// when content exceeds the chosen height.
    private var inputField: some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: draft)
                .font(.body)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
                .frame(height: inputHeight)
                .focused($inputFocused)
                #if os(macOS)
                // .onPasteCommand is macOS-only. On iOS, the paperclip presents
                // a PhotosPicker (images only) — that's the natural way to attach
                // images on a phone, and ⌘V on a paired hardware keyboard would
                // need a separate UIPasteControl integration we haven't added.
                .onPasteCommand(of: pasteAcceptedTypes) { providers in
                    handlePaste(providers)
                }
                #endif
                .onKeyPress(phases: .down) { keyPress in
                    // Plain Return → send. Shift+Return → fall through, TextEditor inserts a newline.
                    // Applies to macOS and to iOS hardware keyboards (iOS 17+).
                    guard keyPress.key == .return else { return .ignored }
                    if keyPress.modifiers.contains(.shift) { return .ignored }
                    send()
                    return .handled
                }

            if draft.wrappedValue.isEmpty {
                Text("iMessage")
                    .font(.body)
                    .foregroundStyle(Color.secondary.opacity(0.7))
                    .padding(.horizontal, 18)
                    .padding(.vertical, 12)
                    .allowsHitTesting(false)
            }
        }
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

    // MARK: - Actions

    private func send() {
        let text = draft.wrappedValue
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let attachments = pendingAttachments
        guard !trimmed.isEmpty || !attachments.isEmpty else {
            logWarn("ui", "send() ignored — empty draft and no attachments")
            return
        }
        logInfo("ui", "send() invoked, chars=\(trimmed.count) attachments=\(attachments.count)")
        draft.wrappedValue = ""
        pendingAttachments = []
        Task { await store.sendMessage(trimmed, attachments: attachments) }
    }

    #if os(macOS)
    private func pickFiles() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.message = "Choose files to send"
        if panel.runModal() == .OK {
            for url in panel.urls { ingestFileURL(url) }
        }
    }
    #endif

    #if os(iOS)
    /// Convert PhotosPicker selections into PendingAttachment entries. We
    /// load the raw image bytes via `loadTransferable(type: Data.self)` so the
    /// chip + upload path is identical to the macOS pasted/file-picker flow.
    @MainActor
    private func ingestPhotoPickerItems(_ items: [PhotosPickerItem]) async {
        for (index, item) in items.enumerated() {
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else { continue }
                let utType = item.supportedContentTypes.first
                let ext = utType?.preferredFilenameExtension ?? "jpg"
                let mime = utType?.preferredMIMEType ?? "image/jpeg"
                let stamp = Int(Date().timeIntervalSince1970)
                pendingAttachments.append(PendingAttachment(
                    filename: "Photo-\(stamp)-\(index).\(ext)",
                    contentType: mime,
                    data: data,
                ))
            } catch {
                logError("ui", "photo ingest failed: \(error.localizedDescription)")
            }
        }
    }
    #endif

    #if os(macOS)
    /// Pasteboard types we want to capture before TextEditor sees them. Text is left
    /// to the standard editor handling — it falls through automatically.
    private var pasteAcceptedTypes: [String] {
        [
            UTType.png.identifier,
            UTType.jpeg.identifier,
            UTType.tiff.identifier,
            UTType.image.identifier,
            UTType.fileURL.identifier,
        ]
    }

    private func handlePaste(_ providers: [NSItemProvider]) {
        let imageTypes = [
            UTType.png.identifier,
            UTType.jpeg.identifier,
            UTType.tiff.identifier,
            UTType.image.identifier,
        ]
        for provider in providers {
            // Image paste — load raw bytes for whichever image type the pasteboard offers first.
            if let type = imageTypes.first(where: { provider.hasItemConformingToTypeIdentifier($0) }) {
                provider.loadDataRepresentation(forTypeIdentifier: type) { data, _ in
                    guard let data = data else { return }
                    let utType = UTType(type)
                    let ext = utType?.preferredFilenameExtension ?? "png"
                    let mime = utType?.preferredMIMEType ?? "image/png"
                    let stamp = Int(Date().timeIntervalSince1970)
                    let attachment = PendingAttachment(
                        filename: "Pasted-\(stamp).\(ext)",
                        contentType: mime,
                        data: data,
                    )
                    Task { @MainActor in
                        pendingAttachments.append(attachment)
                    }
                }
                continue
            }

            // File URL paste (e.g. drag from Finder into a Slack-style composer).
            if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                provider.loadDataRepresentation(forTypeIdentifier: UTType.fileURL.identifier) { data, _ in
                    guard let data, let url = URL(dataRepresentation: data, relativeTo: nil, isAbsolute: true) else { return }
                    Task { @MainActor in
                        ingestFileURL(url)
                    }
                }
            }
        }
    }
    #endif

    @MainActor
    private func ingestFileURL(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            logError("ui", "ingest failed — could not read \(url.lastPathComponent)")
            return
        }
        let mime = (UTType(filenameExtension: url.pathExtension)?.preferredMIMEType)
            ?? "application/octet-stream"
        pendingAttachments.append(PendingAttachment(
            filename: url.lastPathComponent,
            contentType: mime,
            data: data,
        ))
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

// MARK: - Layout helpers

private struct ChatHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

private struct BubbleRowWidthKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

// MARK: - Bubble subviews

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

private struct TableView: View {
    let headers: [String]
    let rows: [[String]]
    let alignments: [MarkdownTableAlignment]
    let onLightBubble: Bool

    var body: some View {
        // Per-column policy: leading columns hug their content at natural
        // width; the *last* column gets `maxWidth: .infinity` so Grid lets it
        // expand to fill the bubble. Without this, Grid would settle at some
        // "comfortable readable width" for descriptive cells and leave the
        // right side of the bubble empty.
        let columnCount = max(headers.count, rows.map(\.count).max() ?? 0)

        return Grid(alignment: .topLeading, horizontalSpacing: 14, verticalSpacing: 4) {
            GridRow {
                ForEach(Array(headers.enumerated()), id: \.offset) { i, header in
                    cell(header, bold: true, columnIndex: i, columnCount: columnCount)
                        .gridColumnAlignment(swiftAlignment(at: i))
                }
            }
            Divider().gridCellUnsizedAxes(.horizontal)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                GridRow {
                    ForEach(Array(row.enumerated()), id: \.offset) { i, value in
                        cell(value, bold: false, columnIndex: i, columnCount: columnCount)
                    }
                }
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(onLightBubble ? Color.black.opacity(0.04) : Color.white.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func cell(_ text: String, bold: Bool, columnIndex: Int, columnCount: Int) -> some View {
        // fixedSize(horizontal: false, vertical: true) lets the cell shrink
        // horizontally (wrap) under width pressure but always show its full
        // wrapped height.
        // The last column gets `frame(maxWidth: .infinity, alignment:)` so
        // Grid hands it the leftover width — this is the modifier that
        // actually makes a 2-col "label / description" table reach the
        // bubble's right edge.
        let isLastColumn = columnIndex == columnCount - 1
        return Text(.init(text))
            .font(bold ? .caption.bold() : .caption)
            .foregroundStyle(onLightBubble ? Color.primary : Color.white)
            .multilineTextAlignment(textAlignment(at: columnIndex))
            .fixedSize(horizontal: false, vertical: true)
            .frame(
                maxWidth: isLastColumn ? .infinity : nil,
                alignment: frameAlignment(at: columnIndex),
            )
            .padding(.vertical, bold ? 4 : 3)
    }

    private func frameAlignment(at i: Int) -> Alignment {
        guard i < alignments.count else { return .leading }
        switch alignments[i] {
        case .leading:  return .leading
        case .center:   return .center
        case .trailing: return .trailing
        }
    }

    private func swiftAlignment(at i: Int) -> HorizontalAlignment {
        guard i < alignments.count else { return .leading }
        switch alignments[i] {
        case .leading:  return .leading
        case .center:   return .center
        case .trailing: return .trailing
        }
    }

    private func textAlignment(at i: Int) -> TextAlignment {
        guard i < alignments.count else { return .leading }
        switch alignments[i] {
        case .leading:  return .leading
        case .center:   return .center
        case .trailing: return .trailing
        }
    }
}

private struct AttachmentChip: View {
    let attachment: PendingAttachment
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: attachment.isImage ? "photo" : "doc")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(attachment.filename)
                .font(.caption)
                .lineLimit(1)
                .truncationMode(.middle)
            Text(formattedSize)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(.regularMaterial, in: Capsule())
        .frame(maxWidth: 240)
    }

    private var formattedSize: String {
        let formatter = ByteCountFormatter()
        formatter.allowedUnits = [.useKB, .useMB, .useGB]
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(attachment.size))
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

    /// Opposite-side gap between the bubble and the chat edge.
    private static let sideGap: CGFloat = 60

    /// Live width of the row, captured via a GeometryReader background.
    /// We use this to set an *explicit* bubble width for messages with wide
    /// content (tables/code) — relying on flex distribution between
    /// `maxWidth: .infinity` and `Spacer(minLength:)` was unreliable; HStack
    /// would split width between them and the bubble never claimed enough.
    @State private var rowWidth: CGFloat = 0

    var body: some View {
        let segments = MarkdownSegmenter.segments(in: message.content)
        let hasWideContent = segments.contains { segment in
            switch segment {
            case .prose: return false
            case .code, .table: return true
            }
        }
        let bubbleWidth: CGFloat? = (hasWideContent && rowWidth > Self.sideGap)
            ? rowWidth - Self.sideGap
            : nil

        return HStack(spacing: 0) {
            if message.isFromUser {
                Spacer(minLength: Self.sideGap)
                bubble(alignment: .trailing, segments: segments)
                    .frame(width: bubbleWidth, alignment: .trailing)
            } else {
                bubble(alignment: .leading, segments: segments)
                    .frame(width: bubbleWidth, alignment: .leading)
                Spacer(minLength: Self.sideGap)
            }
        }
        // Force the row to fill the chat panel, otherwise HStack would size to
        // its content (bubble + Spacer.minLength) and the GeometryReader below
        // would read that content-width instead of the panel width.
        .frame(maxWidth: .infinity, alignment: message.isFromUser ? .trailing : .leading)
        .background(
            GeometryReader { geo in
                Color.clear
                    .preference(key: BubbleRowWidthKey.self, value: geo.size.width)
            },
        )
        .onPreferenceChange(BubbleRowWidthKey.self) { width in
            if abs(rowWidth - width) > 0.5 {
                logInfo("ui", "bubble row width=\(Int(width)) hasWide=\(hasWideContent)")
            }
            rowWidth = width
        }
    }

    @ViewBuilder
    private func bubble(
        alignment: HorizontalAlignment,
        segments: [MarkdownSegment],
    ) -> some View {
        VStack(alignment: alignment, spacing: 2) {
            if !message.isFromUser && showSenderLabel {
                Text(message.senderName)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.leading, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            VStack(alignment: alignment, spacing: 6) {
                ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                    switch segment {
                    case .prose(let text):
                        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                        if !trimmed.isEmpty {
                            Text(.init(trimmed))
                                .textSelection(.enabled)
                                .multilineTextAlignment(alignment == .trailing ? .trailing : .leading)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: alignment == .trailing ? .trailing : .leading)
                        }
                    case .code(let lang, let code):
                        CodeBlockView(language: lang, content: code, onLightBubble: !message.isFromUser)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    case .table(let headers, let rows, let alignments):
                        TableView(
                            headers: headers,
                            rows: rows,
                            alignments: alignments,
                            onLightBubble: !message.isFromUser,
                        )
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: alignment == .trailing ? .trailing : .leading)
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
