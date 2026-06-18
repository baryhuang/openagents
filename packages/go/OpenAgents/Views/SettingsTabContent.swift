import SwiftUI

/// Settings as a first-class destination. Used by:
///   - the iPhone Settings tab (Phase 3)
///   - the Mac Settings destination from the icon rail (Phase 4)
///   - `SettingsSheet`, which wraps this view in modal chrome for the
///     pre-v0.6 entry points that still present settings as a sheet
///     (global `Cmd+,` from `OpenAgentsApp`, the settings button on
///     `WorkspaceSelectorView`)
///
/// Designed to stand alone — it does NOT require a `WorkspaceStore` in
/// the environment, because two of its callers (selector + global
/// shortcut) render before a workspace has been picked. Workspace-scoped
/// rows hide themselves when `router.route` isn't `.workspace`.
struct SettingsTabContent: View {
    @Environment(AppRouter.self) private var router
    @EnvironmentObject private var auth: AuthStore

    @State private var appURLDraft: String = ""
    @State private var apiURLDraft: String = ""
    @State private var saveError: String?
    @State private var saved: Bool = false

    @State private var showDeleteConfirm = false
    @State private var deleting = false
    @State private var deleteError: String?

    private var currentEntry: WorkspaceHistoryEntry? {
        if case .workspace(let entry) = router.route { return entry }
        return nil
    }

    /// Public-facing legal + support destinations. These MUST resolve to live
    /// pages before App Store submission — Review checks the Privacy Policy URL
    /// and an EULA, and rejects dead links.
    private enum Legal {
        static let privacyPolicy = URL(string: "https://openagents.org/privacy")!
        static let termsOfUse = URL(string: "https://openagents.org/terms")!
        // Reporting channel for objectionable content / abuse (guideline 1.2).
        static let reportConcern = URL(string: "mailto:support@openagents.org?subject=Report%20a%20Concern%20(OpenAgents%20Go)")!
    }

    /// A WorkspaceAPI for identity-scoped calls (account deletion). Account
    /// deletion isn't workspace-scoped, so this only needs the API base URL —
    /// prefer the active workspace's, else the default.
    private var accountAPI: WorkspaceAPI {
        WorkspaceAPI(baseURL: currentEntry?.resolvedAPIURL ?? WorkspaceURLs.defaultAPIURL)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if currentEntry != nil {
                    workspaceSection
                }
                if auth.user != nil {
                    accountSection
                }
                if currentEntry != nil {
                    currentWorkspaceURLs
                }
                backendSection
                legalSection
                aboutSection
            }
            .padding(20)
        }
        .background(BrandColors.bg)
        .onAppear { seedURLDrafts() }
        .onChange(of: currentEntry?.workspaceId) { _, _ in seedURLDrafts() }
        .confirmationDialog(
            "Delete your account?",
            isPresented: $showDeleteConfirm,
            titleVisibility: .visible,
        ) {
            Button("Delete Account", role: .destructive) { performDelete() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This permanently deletes your account and removes your data — workspace memberships and registered devices — across all workspaces. This can't be undone.")
        }
    }

    private func seedURLDrafts() {
        appURLDraft = currentEntry?.resolvedAppURL.absoluteString ?? ""
        apiURLDraft = currentEntry?.resolvedAPIURL.absoluteString ?? ""
        saveError = nil
        saved = false
    }

    // MARK: - Workspace switcher

    private var workspaceSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("WORKSPACE")
                .font(.caption.weight(.medium))
                .foregroundStyle(BrandColors.inkFaint)
                .padding(.leading, 4)
            HStack(spacing: 12) {
                WorkspaceTile(name: currentEntry?.name ?? "")
                VStack(alignment: .leading, spacing: 2) {
                    Text(currentEntry?.name ?? "Workspace")
                        .font(.callout.weight(.medium))
                        .lineLimit(1)
                    Text(currentEntry?.displayName ?? "")
                        .font(.caption.monospaced())
                        .foregroundStyle(BrandColors.inkMuted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer(minLength: 8)
                Button("Switch") {
                    router.switchWorkspace()
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
            .padding(12)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        }
    }

    // MARK: - Account

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ACCOUNT")
                .font(.caption.weight(.medium))
                .foregroundStyle(BrandColors.inkFaint)
                .padding(.leading, 4)
            HStack(spacing: 12) {
                AccountAvatar(user: auth.user)
                VStack(alignment: .leading, spacing: 2) {
                    Text(auth.user?.displayName ?? "")
                        .font(.callout.weight(.medium))
                        .lineLimit(1)
                    Text(auth.user?.email ?? "")
                        .font(.caption)
                        .foregroundStyle(BrandColors.inkMuted)
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

            // Account deletion — required by App Store guideline 5.1.1(v).
            HStack(spacing: 8) {
                Button(role: .destructive) {
                    deleteError = nil
                    showDeleteConfirm = true
                } label: {
                    if deleting {
                        ProgressView().controlSize(.small)
                    } else {
                        Label("Delete Account", systemImage: "trash")
                    }
                }
                .buttonStyle(.borderless)
                .controlSize(.small)
                .tint(BrandColors.error)
                .disabled(deleting)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 4)
            .padding(.top, 2)

            if let deleteError {
                Text(deleteError)
                    .font(.caption)
                    .foregroundStyle(BrandColors.error)
                    .padding(.horizontal, 4)
            }
        }
    }

    private func performDelete() {
        deleting = true
        deleteError = nil
        Task {
            do {
                try await auth.deleteAccount(api: accountAPI)
                // signOut() inside deleteAccount flips auth.user to nil, which
                // routes the UI back to the login screen.
            } catch {
                deleteError = (error as NSError).localizedDescription
            }
            deleting = false
        }
    }

    // MARK: - Legal & Support

    private var legalSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("LEGAL & SUPPORT")
                .font(.caption.weight(.medium))
                .foregroundStyle(BrandColors.inkFaint)
                .padding(.leading, 4)
            VStack(alignment: .leading, spacing: 0) {
                legalRow("Privacy Policy", systemImage: "hand.raised", url: Legal.privacyPolicy)
                Divider().padding(.leading, 12)
                legalRow("Terms of Use (EULA)", systemImage: "doc.text", url: Legal.termsOfUse)
                Divider().padding(.leading, 12)
                legalRow("Report a Concern", systemImage: "exclamationmark.bubble", url: Legal.reportConcern)
            }
            .padding(.vertical, 4)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        }
    }

    private func legalRow(_ title: String, systemImage: String, url: URL) -> some View {
        Link(destination: url) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .frame(width: 20)
                    .foregroundStyle(BrandColors.primary)
                Text(title)
                    .font(.callout)
                    .foregroundStyle(BrandColors.inkStrong)
                Spacer(minLength: 8)
                Image(systemName: "arrow.up.right")
                    .font(.caption)
                    .foregroundStyle(BrandColors.inkFaint)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Workspace URLs (editable)

    private var currentWorkspaceURLs: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("ACTIVE WORKSPACE URLS")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(BrandColors.inkFaint)
                Spacer()
                if let entry = currentEntry {
                    Text(entry.displayName)
                        .font(.caption.monospaced())
                        .foregroundStyle(BrandColors.inkMuted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            .padding(.leading, 4)

            VStack(alignment: .leading, spacing: 8) {
                Text("App URL")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(BrandColors.inkFaint)
                TextField(WorkspaceURLs.defaultAppURL.absoluteString, text: $appURLDraft)
                    .textFieldStyle(.roundedBorder)
                    .font(.caption.monospaced())
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    #endif

                Text("API URL")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(BrandColors.inkFaint)
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
                    .foregroundStyle(BrandColors.inkMuted)
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

    // MARK: - Backend defaults

    private var backendSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("DEFAULTS")
                .font(.caption.weight(.medium))
                .foregroundStyle(BrandColors.inkFaint)
                .padding(.leading, 4)
            VStack(alignment: .leading, spacing: 6) {
                LabeledContent("Default app URL") {
                    Text(WorkspaceURLs.defaultAppURL.absoluteString)
                        .foregroundStyle(BrandColors.inkMuted)
                        .font(.caption.monospaced())
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                LabeledContent("Default API URL") {
                    Text(WorkspaceURLs.defaultAPIURL.absoluteString)
                        .foregroundStyle(BrandColors.inkMuted)
                        .font(.caption.monospaced())
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            .padding(12)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        }
    }

    // MARK: - About

    private var aboutSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ABOUT")
                .font(.caption.weight(.medium))
                .foregroundStyle(BrandColors.inkFaint)
                .padding(.leading, 4)
            VStack(alignment: .leading, spacing: 6) {
                LabeledContent("Version") {
                    Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—")
                        .foregroundStyle(BrandColors.inkMuted)
                }
                LabeledContent("Build") {
                    Text(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—")
                        .foregroundStyle(BrandColors.inkMuted)
                }
                LabeledContent("Bundle ID") {
                    Text(Bundle.main.bundleIdentifier ?? "—")
                        .foregroundStyle(BrandColors.inkMuted)
                        .font(.caption.monospaced())
                }
            }
            .padding(12)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        }
    }
}

// MARK: - Avatars

/// 40pt circular avatar — falls back to monogram of display name / email
/// when the user has no photoURL.
struct AccountAvatar: View {
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
            Circle().fill(BrandColors.primary)
            Text(initial)
                .font(.headline.weight(.semibold))
                .foregroundStyle(.white)
        }
    }
}

/// 40pt squircle tile holding the first letter of the workspace name —
/// matches the visual weight of `AccountAvatar` so the workspace and
/// account rows in Settings read as peers.
private struct WorkspaceTile: View {
    let name: String

    var body: some View {
        let initial = name.first.map { String($0).uppercased() } ?? "•"
        ZStack {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [BrandColors.primaryHi, BrandColors.primary],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing,
                    )
                )
            Text(initial)
                .font(.headline.weight(.semibold))
                .foregroundStyle(.white)
        }
        .frame(width: 40, height: 40)
    }
}
