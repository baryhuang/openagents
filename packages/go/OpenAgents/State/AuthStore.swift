import Foundation
import AuthenticationServices
import CryptoKit
import FirebaseCore
import GoogleSignIn

#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

/// Identity exposed to the rest of the app.
struct AuthUser: Equatable {
    let email: String
    let displayName: String
    let photoURL: URL?
}

/// Which login provider issued the current session. Persisted so a cold start
/// can restore the right provider's identity (Apple has no silent token
/// refresh the way GoogleSignIn does — see `restorePreviousSignIn`).
enum AuthProvider: String {
    case google
    case apple
}

/// Google Sign-In wrapper, deliberately *without* FirebaseAuth.
///
/// FirebaseAuth's keychain persistence on macOS sets `kSecAttrAccessGroup`,
/// which makes the Sec API reject every operation unless the app is signed
/// with a `keychain-access-groups` entitlement — and that entitlement is
/// "restricted" so it requires an embedded provisioning profile at runtime
/// (amfid rejects with `-413 No matching profile found` otherwise). We
/// ship Developer ID outside the App Store and don't have a profile, so
/// FirebaseAuth simply can't run here.
///
/// GoogleSignIn alone is enough for what the app needs: a verified email +
/// display name + photoURL + an OIDC ID token. The token is a standard
/// Google JWT that the workspace backend can validate the same way it
/// validates Firebase-issued ones. FirebaseCore is still linked because
/// `FirebaseApp.app()?.options.clientID` is the cleanest place to read the
/// Google OAuth client ID for GIDSignIn configuration.
@MainActor
final class AuthStore: ObservableObject {
    @Published private(set) var user: AuthUser?
    @Published private(set) var idToken: String?
    @Published private(set) var provider: AuthProvider?
    @Published private(set) var loading: Bool = true
    @Published private(set) var lastError: String?

    // Persisted across launches so Apple sessions (which can't be silently
    // refreshed) survive a cold start, and so `freshIdToken()` knows which
    // provider to refresh against.
    private enum Keys {
        static let provider = "auth.provider"
        static let appleUserID = "auth.apple.userID"
        static let appleEmail = "auth.apple.email"
        static let appleDisplayName = "auth.apple.displayName"
    }

    /// Strong ref to the in-flight Apple Sign-In coordinator. ASAuthorization
    /// drops its controller's delegate if nothing retains it, so we park it
    /// here for the duration of the flow.
    private var appleCoordinator: AppleSignInCoordinator?

    init() {
        // Try to silently restore a previously signed-in user. GoogleSignIn
        // caches tokens in the app's standard keychain (no access-group);
        // the restore is best-effort and never throws to the UI.
        Task { @MainActor in
            await restorePreviousSignIn()
            self.loading = false
        }
    }

    private func restorePreviousSignIn() async {
        let stored = UserDefaults.standard.string(forKey: Keys.provider)
            .flatMap(AuthProvider.init(rawValue:))

        // Apple: there's no silent token refresh, so we restore the persisted
        // identity (email + name) and confirm the credential hasn't been
        // revoked in Settings. `idToken` stays nil until the next interactive
        // sign-in; that's fine because workspace access uses the workspace
        // token, and account deletion re-auths for a fresh token.
        if stored == .apple {
            await restorePreviousAppleSignIn()
            return
        }

        guard GIDSignIn.sharedInstance.hasPreviousSignIn() else { return }
        do {
            let restored = try await GIDSignIn.sharedInstance.restorePreviousSignIn()
            apply(googleUser: restored)
        } catch {
            // Restoration failed — user will need to sign in interactively.
            // Don't surface this as an error banner; it's a normal cold start.
            print("[AuthStore] restorePreviousSignIn: \(error)")
        }
    }

    private func restorePreviousAppleSignIn() async {
        let defaults = UserDefaults.standard
        guard let userID = defaults.string(forKey: Keys.appleUserID),
              let email = defaults.string(forKey: Keys.appleEmail) else { return }

        // Drop the session if the user revoked it (Settings → Apple ID →
        // Sign in with Apple) or it transferred away from this device.
        let state = try? await ASAuthorizationAppleIDProvider()
            .credentialState(forUserID: userID)
        if state == .revoked || state == .notFound {
            clearAppleState()
            return
        }

        let displayName = defaults.string(forKey: Keys.appleDisplayName) ?? email
        user = AuthUser(email: email, displayName: displayName, photoURL: nil)
        provider = .apple
        idToken = nil
        persistPushIdentity(email: email, displayName: displayName)
    }

    private func apply(googleUser: GIDGoogleUser) {
        let profile = googleUser.profile
        let email = profile?.email ?? ""
        let displayName = profile?.name ?? email
        let photoURL: URL? = profile?.hasImage == true
            ? profile?.imageURL(withDimension: 96)
            : nil
        user = AuthUser(email: email, displayName: displayName, photoURL: photoURL)
        idToken = googleUser.idToken?.tokenString
        provider = .google
        UserDefaults.standard.set(AuthProvider.google.rawValue, forKey: Keys.provider)
        persistPushIdentity(email: email, displayName: displayName)
    }

    /// Persist the signed-in identity used for @-mention push targeting.
    ///
    /// PushSink (iOS) and WorkspaceStore.bootstrap (both platforms) read these
    /// UserDefaults keys when registering device tokens so mention pushes can
    /// scope to "@me". An empty email clears them (happens on sign-out).
    private func persistPushIdentity(email: String, displayName: String) {
        let trimmed = email.trimmingCharacters(in: .whitespaces).lowercased()
        if trimmed.isEmpty {
            UserDefaults.standard.removeObject(forKey: "pushSink.lastUserEmail")
            UserDefaults.standard.removeObject(forKey: "pushSink.lastUserDisplayName")
        } else {
            UserDefaults.standard.set(trimmed, forKey: "pushSink.lastUserEmail")
            let trimmedDisplay = displayName.trimmingCharacters(in: .whitespaces)
            if trimmedDisplay.isEmpty {
                UserDefaults.standard.removeObject(forKey: "pushSink.lastUserDisplayName")
            } else {
                UserDefaults.standard.set(trimmedDisplay, forKey: "pushSink.lastUserDisplayName")
            }
        }
        // Re-register the cached APNs token with the new email so mention
        // pushes can scope to this user without waiting for the next workspace
        // bootstrap (which may not happen if the app stays foregrounded).
        // No-op on macOS where PushSink doesn't deal in APNs tokens.
        #if os(iOS)
        PushSink.shared.reregisterAfterAuthChange()
        #endif
    }

    // MARK: — Sign in

    /// Launches the Google Sign-In flow and publishes the resulting user.
    func signIn() async {
        lastError = nil
        do {
            guard let clientID = FirebaseApp.app()?.options.clientID else {
                throw NSError(domain: "AuthStore", code: -1, userInfo: [
                    NSLocalizedDescriptionKey: "Missing Firebase client ID — check GoogleService-Info.plist",
                ])
            }
            GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)

            let result = try await presentGoogleSignIn()
            apply(googleUser: result.user)
        } catch {
            // User-cancelled is normal and shouldn't appear as a banner.
            let nsError = error as NSError
            let cancelled =
                nsError.domain == "com.google.GIDSignIn"
                && nsError.code == GIDSignInError.canceled.rawValue
            if !cancelled {
                var parts: [String] = ["[\(nsError.domain) #\(nsError.code)] \(nsError.localizedDescription)"]
                if let reason = nsError.localizedFailureReason {
                    parts.append("Reason: \(reason)")
                }
                if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? NSError {
                    parts.append("Underlying: [\(underlying.domain) #\(underlying.code)] \(underlying.localizedDescription)")
                }
                let extraKeys = nsError.userInfo.keys.filter {
                    $0 != NSLocalizedDescriptionKey
                    && $0 != NSLocalizedFailureReasonErrorKey
                    && $0 != NSUnderlyingErrorKey
                }
                for key in extraKeys.sorted() {
                    parts.append("\(key): \(nsError.userInfo[key] ?? "nil")")
                }
                lastError = parts.joined(separator: "\n")
                print("[AuthStore] signIn failed: \(nsError) userInfo=\(nsError.userInfo)")
            }
        }
    }

    // MARK: — Sign in with Apple

    /// Launches the native Sign in with Apple flow and publishes the resulting
    /// user. Offered alongside Google Sign-In to satisfy App Store guideline
    /// 4.8 (login-service parity). The returned identity token is a JWT the
    /// workspace backend validates via `verify_apple_token`.
    func signInWithApple() async {
        lastError = nil

        // Bind the request to a one-time nonce (Apple best practice for replay
        // protection). We send the SHA-256 in the request; the raw nonce ends
        // up in the identity token's `nonce` claim.
        let rawNonce = Self.randomNonceString()
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = Self.sha256(rawNonce)

        let coordinator = AppleSignInCoordinator()
        self.appleCoordinator = coordinator
        defer { self.appleCoordinator = nil }

        do {
            let credential = try await coordinator.perform(request: request)
            apply(appleCredential: credential)
        } catch {
            let nsError = error as NSError
            // User-cancelled / dismissed — not an error banner.
            let cancelled = nsError.domain == ASAuthorizationError.errorDomain
                && (nsError.code == ASAuthorizationError.canceled.rawValue
                    || nsError.code == ASAuthorizationError.unknown.rawValue)
            if !cancelled {
                lastError = "[Apple Sign-In] \(nsError.localizedDescription)"
                print("[AuthStore] signInWithApple failed: \(nsError)")
            }
        }
    }

    /// Configure the request behind SwiftUI's `SignInWithAppleButton`
    /// (the HIG-compliant button used on the login screen).
    func configureAppleRequest(_ request: ASAuthorizationAppleIDRequest) {
        request.requestedScopes = [.fullName, .email]
        request.nonce = Self.sha256(Self.randomNonceString())
    }

    /// Completion handler for `SignInWithAppleButton`. Routes through the same
    /// `apply(appleCredential:)` sink as the programmatic `signInWithApple()`.
    func handleAppleAuthorization(_ result: Result<ASAuthorization, any Error>) {
        lastError = nil
        switch result {
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
                lastError = "[Apple Sign-In] Unexpected credential type"
                return
            }
            apply(appleCredential: credential)
        case .failure(let error):
            let nsError = error as NSError
            let cancelled = nsError.domain == ASAuthorizationError.errorDomain
                && (nsError.code == ASAuthorizationError.canceled.rawValue
                    || nsError.code == ASAuthorizationError.unknown.rawValue)
            if !cancelled {
                lastError = "[Apple Sign-In] \(nsError.localizedDescription)"
                print("[AuthStore] handleAppleAuthorization failed: \(nsError)")
            }
        }
    }

    private func apply(appleCredential credential: ASAuthorizationAppleIDCredential) {
        guard let tokenData = credential.identityToken,
              let token = String(data: tokenData, encoding: .utf8) else {
            lastError = "[Apple Sign-In] Missing identity token"
            return
        }

        // `email` and `fullName` are only populated on the FIRST authorization;
        // on later sign-ins we read the email back out of the identity token's
        // claims. Fall back through token claim → "Apple User".
        let claims = Self.decodeJWTClaims(token)
        let email = credential.email
            ?? (claims["email"] as? String)
            ?? ""
        let nameFromCredential = [credential.fullName?.givenName, credential.fullName?.familyName]
            .compactMap { $0 }
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespaces)
        let displayName: String = {
            if !nameFromCredential.isEmpty { return nameFromCredential }
            if !email.isEmpty { return email }
            return "Apple User"
        }()

        user = AuthUser(email: email, displayName: displayName, photoURL: nil)
        idToken = token
        provider = .apple

        let defaults = UserDefaults.standard
        defaults.set(AuthProvider.apple.rawValue, forKey: Keys.provider)
        defaults.set(credential.user, forKey: Keys.appleUserID)
        defaults.set(email, forKey: Keys.appleEmail)
        defaults.set(displayName, forKey: Keys.appleDisplayName)

        persistPushIdentity(email: email, displayName: displayName)
    }

    // MARK: — Nonce / JWT helpers

    /// Cryptographically-random nonce string (Apple's recommended recipe).
    private static func randomNonceString(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        var remaining = length
        while remaining > 0 {
            var randoms = [UInt8](repeating: 0, count: 16)
            _ = SecRandomCopyBytes(kSecRandomDefault, randoms.count, &randoms)
            for random in randoms where remaining > 0 {
                if random < UInt8(charset.count) {
                    result.append(charset[Int(random)])
                    remaining -= 1
                }
            }
        }
        return result
    }

    private static func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }

    /// Best-effort decode of a JWT payload to a claims dictionary. No signature
    /// check — the backend verifies; this only reads the email claim for
    /// display. Returns an empty dict if the token is malformed.
    private static func decodeJWTClaims(_ jwt: String) -> [String: Any] {
        let segments = jwt.split(separator: ".")
        guard segments.count >= 2 else { return [:] }
        var base64 = String(segments[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        // Re-pad to a multiple of 4 for Foundation's strict base64 decoder.
        while base64.count % 4 != 0 { base64.append("=") }
        guard let data = Data(base64Encoded: base64),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return [:]
        }
        return json
    }

    /// Platform-specific bridge into the Google Sign-In SDK. On iOS we hand
    /// it the topmost view controller; on macOS we hand it the key window.
    private func presentGoogleSignIn() async throws -> GIDSignInResult {
        #if os(iOS)
        guard let presenter = await topMostViewController() else {
            throw NSError(domain: "AuthStore", code: -3, userInfo: [
                NSLocalizedDescriptionKey: "No presenting view controller available",
            ])
        }
        return try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter)
        #elseif os(macOS)
        guard let window = NSApp.keyWindow ?? NSApp.windows.first else {
            throw NSError(domain: "AuthStore", code: -3, userInfo: [
                NSLocalizedDescriptionKey: "No presenting window available",
            ])
        }
        return try await GIDSignIn.sharedInstance.signIn(withPresenting: window)
        #endif
    }

    #if os(iOS)
    private func topMostViewController() async -> UIViewController? {
        let root = await MainActor.run { () -> UIViewController? in
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap { $0.windows }
                .first(where: { $0.isKeyWindow })?
                .rootViewController
        }
        var top = root
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
    #endif

    // MARK: — Sign out

    func signOut() {
        GIDSignIn.sharedInstance.signOut()
        user = nil
        idToken = nil
        provider = nil
        UserDefaults.standard.removeObject(forKey: Keys.provider)
        clearAppleState()
        UserDefaults.standard.removeObject(forKey: "pushSink.lastUserEmail")
        UserDefaults.standard.removeObject(forKey: "pushSink.lastUserDisplayName")
        // Re-register so the device_tokens row clears its user_email and
        // we stop receiving mention pushes addressed to the signed-out user.
        #if os(iOS)
        PushSink.shared.reregisterAfterAuthChange()
        #endif
    }

    private func clearAppleState() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: Keys.appleUserID)
        defaults.removeObject(forKey: Keys.appleEmail)
        defaults.removeObject(forKey: Keys.appleDisplayName)
    }

    // MARK: — Account deletion

    /// Permanently delete the signed-in user's account and server-side data,
    /// then sign out locally. Satisfies App Store guideline 5.1.1(v).
    ///
    /// The backend (`DELETE /v1/account`) authenticates via the identity
    /// bearer token, so we first obtain a FRESH one — Google tokens are
    /// refreshed silently; an Apple session restored from a cold start has no
    /// live token, so we re-run the Apple flow to mint one. Throws on failure
    /// so the UI can surface it; only signs out after the server confirms.
    func deleteAccount(api: WorkspaceAPI) async throws {
        guard let token = await freshIdToken() else {
            throw NSError(domain: "AuthStore", code: -10, userInfo: [
                NSLocalizedDescriptionKey: "Couldn't confirm your identity. Please sign in again, then delete your account.",
            ])
        }
        try await api.deleteAccount(idToken: token)
        signOut()
    }

    /// A usable identity token for READ calls (e.g. listing account workspaces).
    /// Refreshes the Google token silently; returns the cached Apple token if
    /// present. Never forces interactive re-auth — returns nil instead, so a
    /// passive fetch can't pop a sign-in sheet on app open.
    func readIdToken() async -> String? {
        if provider == .google, let current = GIDSignIn.sharedInstance.currentUser,
           let refreshed = try? await current.refreshTokensIfNeeded() {
            idToken = refreshed.idToken?.tokenString
        }
        return idToken
    }

    /// Returns a currently-valid identity token for the active provider, or nil
    /// if one can't be obtained without further user interaction.
    private func freshIdToken() async -> String? {
        switch provider {
        case .google:
            guard let current = GIDSignIn.sharedInstance.currentUser else { return idToken }
            if let refreshed = try? await current.refreshTokensIfNeeded() {
                idToken = refreshed.idToken?.tokenString
            }
            return idToken
        case .apple:
            // A live token from this session works as-is; otherwise re-auth to
            // mint a fresh one (restored Apple sessions carry no token).
            if let token = idToken { return token }
            await signInWithApple()
            return idToken
        case .none:
            return idToken
        }
    }

    // MARK: — Helpers

    /// The display name used to tag outgoing chat messages — mirrors the web's
    /// `senderName = user.displayName ?? user.email ?? 'user'` fallback chain.
    var senderName: String {
        let candidate = user?.displayName.trimmingCharacters(in: .whitespaces) ?? ""
        if !candidate.isEmpty { return candidate }
        let email = user?.email.trimmingCharacters(in: .whitespaces) ?? ""
        if !email.isEmpty { return email }
        return "user"
    }
}

/// Bridges the callback-based `ASAuthorizationController` API into async/await.
/// `ASAuthorizationControllerDelegate` callbacks are delivered on the main
/// actor, so the whole coordinator is `@MainActor`-isolated.
@MainActor
private final class AppleSignInCoordinator: NSObject,
    ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding {

    private var continuation: CheckedContinuation<ASAuthorizationAppleIDCredential, Error>?

    func perform(request: ASAuthorizationAppleIDRequest) async throws -> ASAuthorizationAppleIDCredential {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization,
    ) {
        defer { continuation = nil }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
            continuation?.resume(throwing: NSError(
                domain: ASAuthorizationError.errorDomain,
                code: ASAuthorizationError.failed.rawValue,
                userInfo: [NSLocalizedDescriptionKey: "Unexpected Apple credential type"],
            ))
            return
        }
        continuation?.resume(returning: credential)
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error,
    ) {
        continuation?.resume(throwing: error)
        continuation = nil
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        #if os(iOS)
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap { $0.windows }.first(where: { $0.isKeyWindow })
            ?? scenes.first?.windows.first
        return window ?? ASPresentationAnchor()
        #elseif os(macOS)
        return NSApp.keyWindow ?? NSApp.windows.first ?? ASPresentationAnchor()
        #endif
    }
}
