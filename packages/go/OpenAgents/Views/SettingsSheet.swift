import SwiftUI

private struct AccountAvatar: View {
    let user: AuthUser?

    var body: some View {
        let initial = (user?.displayName.first ?? user?.email.first).map { String($0).uppercased() } ?? "?"
        if let url = user?.photoURL {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    fallback(initial: initial)
                }
            }
            .frame(width: 40, height: 40)
            .clipShape(Circle())
        } else {
            fallback(initial: initial)
                .frame(width: 40, height: 40)
        }
    }

    private func fallback(initial: String) -> some View {
        ZStack {
            Circle().fill(Color.accentColor)
            Text(initial)
                .font(.headline.weight(.semibold))
                .foregroundStyle(.white)
        }
    }
}

struct SettingsSheet: View {
    @Binding var isPresented: Bool
    @Environment(AppRouter.self) private var router
    @EnvironmentObject private var auth: AuthStore

    @State private var appURLDraft: String = ""
    @State private var apiURLDraft: String = ""
    @State private var saveError: String?
    @State private var saved: Bool = false

    private var currentEntry: WorkspaceHistoryEntry? {
        if case .workspace(let entry) = router.route { return entry }
        return nil
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Settings").font(.headline)
                Spacer()
                Button {
                    isPresented = false
                } label: {
                    Image(systemName: "xmark")
                        .foregroundStyle(.secondary)
                        .padding(8)
                }
                .buttonStyle(.plain)
                .background(.regularMaterial, in: Circle())
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if auth.user != nil {
                        accountSection
                    }
                    if currentEntry != nil {
                        currentWorkspaceURLs
                    }
                    backendSection
                    aboutSection
                }
                .padding(20)
            }
        }
        #if os(macOS)
        .frame(minWidth: 480, idealWidth: 540, minHeight: 480, idealHeight: 600)
        #else
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        #endif
        .onAppear {
            seedURLDrafts()
        }
        .onChange(of: currentEntry?.workspaceId) { _, _ in
            seedURLDrafts()
        }
    }

    private func seedURLDrafts() {
        appURLDraft = currentEntry?.resolvedAppURL.absoluteString ?? ""
        apiURLDraft = currentEntry?.resolvedAPIURL.absoluteString ?? ""
        saveError = nil
        saved = false
    }

    /// Shows the active workspace's URL pair and lets the user fix them in place. Saving
    /// re-applies the workspace via AppRouter.connect, which recreates the WorkspaceStore
    /// with the new API URL on its next render.
    private var currentWorkspaceURLs: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("ACTIVE WORKSPACE")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.tertiary)
                Spacer()
                if let entry = currentEntry {
                    Text(entry.displayName)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            .padding(.leading, 4)

            VStack(alignment: .leading, spacing: 8) {
                Text("App URL")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.tertiary)
                TextField(WorkspaceURLs.defaultAppURL.absoluteString, text: $appURLDraft)
                    .textFieldStyle(.roundedBorder)
                    .font(.caption.monospaced())
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    #endif

                Text("API URL")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.tertiary)
                    .padding(.top, 4)
                TextField(WorkspaceURLs.defaultAPIURL.absoluteString, text: $apiURLDraft)
                    .textFieldStyle(.roundedBorder)
                    .font(.caption.monospaced())
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    #endif

                if let saveError {
                    Text(saveError)
                        .font(.caption)
                        .foregroundStyle(.red)
                }

                HStack {
                    Button("Save & Reconnect") { save() }
                        .buttonStyle(.borderedProminent)
                        .disabled(currentEntry == nil)
                    if saved {
                        Label("Saved", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                            .font(.caption)
                    }
                }
                Text("Saving reconnects to this workspace using the new URL pair, and persists the pair so future launches use it too.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 2)
            }
            .padding(12)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        }
    }

    private func save() {
        guard let entry = currentEntry else { return }
        saveError = nil
        let appTrim = appURLDraft.trimmingCharacters(in: .whitespaces)
        let apiTrim = apiURLDraft.trimmingCharacters(in: .whitespaces)
        guard let appURL = URL(string: appTrim), appURL.scheme == "http" || appURL.scheme == "https" else {
            saveError = "App URL must be a valid http(s) URL."
            return
        }
        guard let apiURL = URL(string: apiTrim), apiURL.scheme == "http" || apiURL.scheme == "https" else {
            saveError = "API URL must be a valid http(s) URL."
            return
        }
        router.connect(
            workspaceId: entry.workspaceId,
            token: entry.workspaceToken,
            name: entry.name,
            appURL: appURL,
            apiURL: apiURL,
        )
        saved = true
    }

    private var backendSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("DEFAULTS")
                .font(.caption.weight(.medium))
                .foregroundStyle(.tertiary)
                .padding(.leading, 4)
            VStack(alignment: .leading, spacing: 6) {
                LabeledContent("Default app URL") {
                    Text(WorkspaceURLs.defaultAppURL.absoluteString)
                        .foregroundStyle(.secondary)
                        .font(.caption.monospaced())
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                LabeledContent("Default API URL") {
                    Text(WorkspaceURLs.defaultAPIURL.absoluteString)
                        .foregroundStyle(.secondary)
                        .font(.caption.monospaced())
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            .padding(12)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        }
    }

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ACCOUNT")
                .font(.caption.weight(.medium))
                .foregroundStyle(.tertiary)
                .padding(.leading, 4)
            HStack(spacing: 12) {
                AccountAvatar(user: auth.user)
                VStack(alignment: .leading, spacing: 2) {
                    Text(auth.user?.displayName ?? "")
                        .font(.callout.weight(.medium))
                        .lineLimit(1)
                    Text(auth.user?.email ?? "")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Button("Sign Out") {
                    auth.signOut()
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
            .padding(12)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        }
    }

    private var aboutSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ABOUT")
                .font(.caption.weight(.medium))
                .foregroundStyle(.tertiary)
                .padding(.leading, 4)
            VStack(alignment: .leading, spacing: 6) {
                LabeledContent("Version") {
                    Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—")
                        .foregroundStyle(.secondary)
                }
                LabeledContent("Build") {
                    Text(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—")
                        .foregroundStyle(.secondary)
                }
                LabeledContent("Bundle ID") {
                    Text(Bundle.main.bundleIdentifier ?? "—")
                        .foregroundStyle(.secondary)
                        .font(.caption.monospaced())
                }
            }
            .padding(12)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        }
    }
}
