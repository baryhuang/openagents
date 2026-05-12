import SwiftUI

/// Right-side panel listing workspace files. Mirrors the "Content" sidebar
/// in the React workspace UI (see screenshot in PR description). v1 lists
/// every file in the workspace sorted by most recent upload; per-thread /
/// per-artifact scoping is a follow-up.
struct ContentSidebar: View {
    @Environment(WorkspaceStore.self) private var store
    @Binding var isPresented: Bool

    @State private var files: [WorkspaceFile] = []
    @State private var loading: Bool = false
    @State private var loadError: String?

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if loading && files.isEmpty {
                loadingState
            } else if let loadError, files.isEmpty {
                errorState(message: loadError)
            } else if files.isEmpty {
                emptyState
            } else {
                fileList
            }
        }
        .background(sidebarBackground)
        .task(id: store.workspaceId) {
            await refresh()
        }
    }

    // MARK: - Sections

    private var header: some View {
        HStack(spacing: 8) {
            Text("Content")
                .font(.headline)
            Spacer()
            Button {
                Task { await refresh() }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Refresh files")
            #if os(macOS)
            .help("Refresh")
            #endif

            Button {
                isPresented = false
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close content sidebar")
            #if os(macOS)
            .help("Close")
            #endif
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private var loadingState: some View {
        VStack(spacing: 10) {
            ProgressView()
            Text("Loading files…")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(message: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle")
                .foregroundStyle(.orange)
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Retry") {
                Task { await refresh() }
            }
            .buttonStyle(.bordered)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "folder")
                .font(.system(size: 28))
                .foregroundStyle(.tertiary)
            Text("No files yet")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var fileList: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(sortedFiles) { file in
                    FileCard(file: file)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
        }
    }

    /// Newest first. Files with no createdAt sink to the bottom so the
    /// recent-activity affordance stays correct on the (rare) legacy rows.
    private var sortedFiles: [WorkspaceFile] {
        files.sorted { lhs, rhs in
            switch (lhs.createdAtDate, rhs.createdAtDate) {
            case (let l?, let r?): return l > r
            case (_?, nil):        return true
            case (nil, _?):        return false
            case (nil, nil):       return lhs.filename < rhs.filename
            }
        }
    }

    private var sidebarBackground: Color {
        #if os(macOS)
        Color(.windowBackgroundColor)
        #else
        Color(.systemBackground)
        #endif
    }

    // MARK: - Loading

    private func refresh() async {
        loading = true
        defer { loading = false }
        do {
            files = try await store.listFiles(channel: nil, limit: 100)
            loadError = nil
        } catch {
            loadError = error.localizedDescription
            logError("ui", "ContentSidebar listFiles failed: \(error.localizedDescription)")
        }
    }
}

// MARK: - File card

private struct FileCard: View {
    let file: WorkspaceFile

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            thumbnail
                .frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                Text(file.basename)
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                HStack(spacing: 6) {
                    Text(file.kind.label)
                        .font(.system(size: 9, weight: .semibold))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(file.kind.tint.opacity(0.18), in: Capsule())
                        .foregroundStyle(file.kind.tint)
                    if file.size > 0 {
                        Text(byteString(file.size))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                if let date = file.createdAtDate {
                    Text(relativeTime(from: date))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(.gray.opacity(0.08)),
        )
    }

    @ViewBuilder
    private var thumbnail: some View {
        switch file.kind {
        case .image:
            AuthorizedAsyncImage(fileId: file.id)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        default:
            ZStack {
                Rectangle()
                    .fill(.gray.opacity(0.18))
                Image(systemName: file.kind.systemImage)
                    .font(.system(size: 18))
                    .foregroundStyle(file.kind.tint)
            }
        }
    }

    private func byteString(_ size: Int) -> String {
        let f = ByteCountFormatter()
        f.allowedUnits = [.useKB, .useMB, .useGB]
        f.countStyle = .file
        return f.string(fromByteCount: Int64(size))
    }

    /// "3d ago", "12m ago" — same shape the React sidebar uses.
    private func relativeTime(from date: Date) -> String {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - File kind styling

private extension WorkspaceFile.Kind {
    var label: String {
        switch self {
        case .image:   return "IMG"
        case .text:    return "TXT"
        case .pdf:     return "PDF"
        case .audio:   return "AUD"
        case .video:   return "VID"
        case .archive: return "ZIP"
        case .code:    return "CODE"
        case .other:   return "FILE"
        }
    }
    var systemImage: String {
        switch self {
        case .image:   return "photo"
        case .text:    return "doc.text"
        case .pdf:     return "doc.richtext"
        case .audio:   return "waveform"
        case .video:   return "play.rectangle"
        case .archive: return "archivebox"
        case .code:    return "chevron.left.forwardslash.chevron.right"
        case .other:   return "doc"
        }
    }
    var tint: Color {
        switch self {
        case .image:   return .purple
        case .text:    return .blue
        case .pdf:     return .red
        case .audio:   return .pink
        case .video:   return .orange
        case .archive: return .brown
        case .code:    return .green
        case .other:   return .gray
        }
    }
}

// MARK: - Authenticated AsyncImage

/// `AsyncImage` doesn't accept custom headers, but the workspace file
/// endpoint requires `X-Workspace-Token`. This small loader bridges that
/// gap: pre-built `URLRequest` from `WorkspaceStore.authorizedFileDownloadRequest`,
/// fetched via the shared session, cached in `URLCache.shared` so flipping
/// the sidebar open repeatedly doesn't re-download the same thumbnails.
private struct AuthorizedAsyncImage: View {
    let fileId: String

    @Environment(WorkspaceStore.self) private var store
    @State private var phase: LoadPhase = .loading

    private enum LoadPhase {
        case loading
        case loaded(PlatformImage)
        case failed
    }

    var body: some View {
        ZStack {
            switch phase {
            case .loading:
                Rectangle()
                    .fill(.gray.opacity(0.12))
                ProgressView()
                    .controlSize(.small)
            case .failed:
                Rectangle()
                    .fill(.gray.opacity(0.12))
                Image(systemName: "photo")
                    .foregroundStyle(.tertiary)
            case .loaded(let image):
                imageView(image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            }
        }
        .task(id: fileId) {
            await load()
        }
    }

    private func load() async {
        do {
            let request = await store.authorizedFileDownloadRequest(fileId: fileId)
            let (data, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                phase = .failed
                return
            }
            #if os(macOS)
            if let img = NSImage(data: data) {
                phase = .loaded(img)
            } else {
                phase = .failed
            }
            #else
            if let img = UIImage(data: data) {
                phase = .loaded(img)
            } else {
                phase = .failed
            }
            #endif
        } catch {
            phase = .failed
        }
    }

    @ViewBuilder
    private func imageView(_ image: PlatformImage) -> Image {
        #if os(macOS)
        Image(nsImage: image)
        #else
        Image(uiImage: image)
        #endif
    }
}

#if os(macOS)
import AppKit
private typealias PlatformImage = NSImage
#else
import UIKit
private typealias PlatformImage = UIImage
#endif
