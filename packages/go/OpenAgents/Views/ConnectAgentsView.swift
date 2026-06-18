import SwiftUI
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

/// Shown when the active workspace has no agents yet — the natural state right
/// after creating a workspace. Agents run on the user's own computer via the
/// OpenAgents CLI / Launcher (a sandboxed iOS/macOS app can't spawn them), so
/// this page hands over the exact command + token to connect one, then lets the
/// user re-check membership.
struct ConnectAgentsView: View {
    @Environment(WorkspaceStore.self) private var store

    /// Dismiss handler supplied by the presenter (sheet).
    var onClose: (() -> Void)?

    @State private var refreshing = false

    /// Public download page for the desktop Launcher (placeholder — point at the
    /// real release page before shipping).
    private static let launcherURL = URL(string: "https://openagents.org/download")!

    private var installCommand: String {
        "npm install -g @openagents-org/agent-connector"
    }

    private var connectCommand: String {
        // `agn` is the agent-connector CLI binary. The token is this
        // workspace's access token; the agent joins on connect.
        "agn connect my-agent \(store.token)"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header

                stepCard(
                    number: 1,
                    title: "Install the agent connector",
                    detail: "On the computer where your agent will run:",
                    command: installCommand,
                )

                stepCard(
                    number: 2,
                    title: "Connect an agent to this workspace",
                    detail: "Creates an agent and joins it here. Swap `my-agent` for any name.",
                    command: connectCommand,
                )

                tokenCard

                VStack(alignment: .leading, spacing: 10) {
                    Text("Prefer a desktop app?")
                        .font(BrandFonts.bodyMedium)
                        .foregroundStyle(BrandColors.inkStrong)
                    Link(destination: Self.launcherURL) {
                        HStack(spacing: 8) {
                            Image(systemName: "arrow.down.circle")
                            Text("Download the OpenAgents Launcher")
                            Spacer()
                            Image(systemName: "arrow.up.right").font(.caption)
                        }
                        .padding(12)
                        .background(BrandColors.surface, in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(BrandColors.hairline, lineWidth: 0.5))
                    }
                    .buttonStyle(.plain)
                }

                refreshButton
            }
            .padding(24)
            .frame(maxWidth: 520, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(BrandColors.bg)
    }

    // MARK: - Sections

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "cpu")
                    .font(.system(size: 22))
                    .foregroundStyle(BrandColors.primary)
                Spacer()
                if onClose != nil {
                    Button { onClose?() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(BrandColors.inkFaint)
                    }
                    .buttonStyle(.plain)
                }
            }
            Text("Connect an agent")
                .font(BrandFonts.displaySmall)
                .foregroundStyle(BrandColors.inkStrong)
            Text("“\(store.workspace?.name ?? "This workspace")” has no agents yet. Agents run on your own machine and join over the OpenAgents CLI — set one up in under a minute.")
                .font(BrandFonts.callout)
                .foregroundStyle(BrandColors.inkMuted)
        }
    }

    private func stepCard(number: Int, title: String, detail: String, command: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("\(number)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(width: 22, height: 22)
                    .background(BrandColors.primary, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(BrandFonts.bodyMedium)
                        .foregroundStyle(BrandColors.inkStrong)
                    Text(detail)
                        .font(BrandFonts.caption)
                        .foregroundStyle(BrandColors.inkMuted)
                }
            }
            CommandRow(command: command)
        }
        .padding(14)
        .background(BrandColors.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(BrandColors.hairline, lineWidth: 0.5))
    }

    private var tokenCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("WORKSPACE")
                .font(BrandFonts.sectionEyebrow)
                .tracking(0.8)
                .foregroundStyle(BrandColors.inkFaint)
            LabeledValue(label: "ID", value: store.workspaceId)
            LabeledValue(label: "Token", value: store.token, secret: true)
        }
        .padding(14)
        .background(BrandColors.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(BrandColors.hairline, lineWidth: 0.5))
    }

    private var refreshButton: some View {
        Button {
            Task {
                refreshing = true
                await store.refreshDiscovery()
                refreshing = false
                // An agent showed up — the workspace is live; close the page.
                if !store.agents.isEmpty { onClose?() }
            }
        } label: {
            HStack(spacing: 8) {
                if refreshing {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "arrow.clockwise")
                }
                Text(refreshing ? "Checking…" : "I've connected an agent")
                    .font(BrandFonts.bodyMedium)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
        }
        .buttonStyle(.borderedProminent)
        .tint(BrandColors.primary)
        .controlSize(.large)
        .disabled(refreshing)
    }
}

// MARK: - Reusable rows

/// Monospaced command with a copy button.
private struct CommandRow: View {
    let command: String
    @State private var copied = false

    var body: some View {
        HStack(spacing: 8) {
            Text(command)
                .font(.caption.monospaced())
                .foregroundStyle(BrandColors.inkStrong)
                .textSelection(.enabled)
                .lineLimit(2)
                .truncationMode(.middle)
            Spacer(minLength: 8)
            Button {
                Clipboard.copy(command)
                copied = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { copied = false }
            } label: {
                Image(systemName: copied ? "checkmark" : "doc.on.doc")
                    .font(.caption)
                    .foregroundStyle(copied ? .green : BrandColors.inkMuted)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(BrandColors.bg, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(BrandColors.hairline, lineWidth: 0.5))
    }
}

private struct LabeledValue: View {
    let label: String
    let value: String
    var secret: Bool = false
    @State private var revealed = false
    @State private var copied = false

    var body: some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.caption.weight(.medium))
                .foregroundStyle(BrandColors.inkMuted)
                .frame(width: 44, alignment: .leading)
            Text(secret && !revealed ? String(repeating: "•", count: min(value.count, 24)) : value)
                .font(.caption.monospaced())
                .foregroundStyle(BrandColors.inkStrong)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
            Spacer(minLength: 8)
            if secret {
                Button { revealed.toggle() } label: {
                    Image(systemName: revealed ? "eye.slash" : "eye")
                        .font(.caption)
                        .foregroundStyle(BrandColors.inkMuted)
                }
                .buttonStyle(.plain)
            }
            Button {
                Clipboard.copy(value)
                copied = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { copied = false }
            } label: {
                Image(systemName: copied ? "checkmark" : "doc.on.doc")
                    .font(.caption)
                    .foregroundStyle(copied ? .green : BrandColors.inkMuted)
            }
            .buttonStyle(.plain)
        }
    }
}

/// Cross-platform clipboard write.
enum Clipboard {
    static func copy(_ string: String) {
        #if os(iOS)
        UIPasteboard.general.string = string
        #elseif os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(string, forType: .string)
        #endif
    }
}
