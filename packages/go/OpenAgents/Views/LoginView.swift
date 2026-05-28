import SwiftUI

/// Shown when no Firebase user is signed in. Mirrors the web LoginScreen:
/// centered card with the app icon, title, subtitle, and a single
/// "Sign in with Google" button.
struct LoginView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var signingIn = false

    var body: some View {
        VStack(spacing: 32) {
            VStack(spacing: 12) {
                appIcon
                Text("Sign in to OpenAgents")
                    .font(.title2.weight(.semibold))
                Text("Continue with your Google account to access your workspaces.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 320)
            }

            Button {
                Task {
                    signingIn = true
                    await auth.signIn()
                    signingIn = false
                }
            } label: {
                HStack(spacing: 12) {
                    if signingIn {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "g.circle.fill")
                            .font(.system(size: 18))
                    }
                    Text(signingIn ? "Signing in…" : "Sign in with Google")
                        .fontWeight(.medium)
                }
                .frame(maxWidth: 280)
                .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(signingIn)

            if let error = auth.lastError {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 320)
            }
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(backgroundColor)
    }

    private var appIcon: some View {
        #if os(macOS)
        Image(nsImage: NSImage(named: "AppIcon") ?? NSImage())
            .resizable()
            .interpolation(.high)
            .frame(width: 64, height: 64)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        #else
        Image(uiImage: UIImage(named: "AppIcon") ?? UIImage())
            .resizable()
            .interpolation(.high)
            .frame(width: 64, height: 64)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        #endif
    }

    private var backgroundColor: Color {
        #if os(macOS)
        Color(NSColor.windowBackgroundColor)
        #else
        Color(UIColor.systemBackground)
        #endif
    }
}
