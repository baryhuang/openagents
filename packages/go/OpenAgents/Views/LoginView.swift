import SwiftUI
import AuthenticationServices

/// Shown when no user is signed in. Mirrors the web LoginScreen: centered card
/// with the app icon, title, subtitle, and the login options — Google plus
/// Sign in with Apple (required for App Store guideline 4.8 login parity).
struct LoginView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var signingIn = false
    @State private var appear = false

    var body: some View {
        VStack(spacing: 32) {
            VStack(spacing: 14) {
                appIcon
                Text("Sign in to OpenAgents")
                    .font(BrandFonts.displaySmall)
                    .foregroundStyle(BrandColors.inkStrong)
                Text("AGENT WORKSPACE")
                    .font(BrandFonts.sectionEyebrow)
                    .tracking(3.2)
                    .foregroundStyle(BrandColors.primary)
                    .padding(.top, 2)
                Text("Continue with your Google or Apple account to access your workspaces.")
                    .font(BrandFonts.callout)
                    .foregroundStyle(BrandColors.inkMuted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 320)
                    .padding(.top, 8)
            }

            // Both providers, identical footprint: full width, 52pt tall, same
            // 12pt corner radius. Google is a custom button following Google's
            // light-theme branding (white field, official multicolor "G",
            // #1F1F1F text); Apple is the system SignInWithAppleButton.
            VStack(spacing: 12) {
                Button {
                    Task {
                        signingIn = true
                        await auth.signIn()
                        signingIn = false
                    }
                } label: {
                    HStack(spacing: 12) {
                        if signingIn {
                            ProgressView().controlSize(.small)
                        } else {
                            Image("GoogleLogo")
                                .resizable()
                                .scaledToFit()
                                .frame(width: 20, height: 20)
                        }
                        Text("Sign in with Google")
                            .font(BrandFonts.bodyMedium)
                            .foregroundStyle(Color(red: 0.122, green: 0.122, blue: 0.122))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(Color(white: 0.85), lineWidth: 1),
                    )
                }
                .buttonStyle(.plain)
                .disabled(signingIn)

                SignInWithAppleButton(.signIn) { request in
                    auth.configureAppleRequest(request)
                } onCompletion: { result in
                    auth.handleAppleAuthorization(result)
                }
                .signInWithAppleButtonStyle(.black)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .disabled(signingIn)
            }
            .frame(maxWidth: 320)

            if let error = auth.lastError {
                Text(error)
                    .font(BrandFonts.footnote)
                    .foregroundStyle(BrandColors.error)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 320)
            }
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BrandColors.bg)
        .opacity(appear ? 1 : 0)
        .scaleEffect(appear ? 1 : 0.96)
        .animation(.easeOut(duration: 0.45), value: appear)
        .onAppear { appear = true }
    }

    @ViewBuilder
    private var appIcon: some View {
        #if os(macOS)
        // macOS exposes the running app's icon at runtime — prefer it so the
        // user's custom-icon override (if any) carries through.
        if let nsImage = NSImage(named: "AppIcon") {
            Image(nsImage: nsImage)
                .resizable()
                .interpolation(.high)
                .frame(width: 88, height: 88)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        } else {
            AppIconBadge(size: 88)
        }
        #else
        // iOS has no equivalent runtime API — `UIImage(named: "AppIcon")`
        // returns nil because AppIcon assets aren't loadable as regular
        // images. Render the SwiftUI badge that mirrors the master PNG.
        AppIconBadge(size: 88)
        #endif
    }
}
