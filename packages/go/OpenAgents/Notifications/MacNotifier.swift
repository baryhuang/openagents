#if os(macOS)
import AppKit
import Foundation
import UserNotifications

/// macOS-only local notification surface. Bypasses the
/// FCM-/APNs-replacement stack on iOS — macOS apps distributed via
/// Developer ID outside the App Store can't carry the `aps-environment`
/// entitlement (amfid rejects restricted entitlements without an embedded
/// provisioning profile), so remote push isn't available. Instead, the
/// message polling loop drives local notifications via
/// `UNUserNotificationCenter` — which needs no entitlement.
///
/// Behaviour mirrors the iOS PushSink:
///   - `currentVisibleChannel` lets the chat view suppress banners that
///     would be redundant with what the user is already reading.
///   - Banners suppressed entirely while the app window is the active app
///     AND the user is viewing the same channel.
///   - Tap on a banner deep-links into the channel via AppRouter, same
///     contract as iOS.
@MainActor
final class MacNotifier: NSObject {
    static let shared = MacNotifier()

    /// The chat view updates this on appear/disappear so we can suppress
    /// redundant banners when the user is already inside the channel and
    /// the app is frontmost.
    var currentVisibleChannel: String?

    /// When the user taps a banner, the target channel name lands here.
    /// `ThreadListView` (the sidebar) drains it on its next render and
    /// selects the corresponding session — mirrors iOS `PushSink`.
    var pendingDeepLinkChannel: String?

    private var permissionRequested = false
    private var permissionGranted = false

    private override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
    }

    /// Idempotent — called whenever the app reaches a state where it's
    /// reasonable to ask the user (after sign-in, when a workspace loads).
    func requestPermission() {
        if permissionRequested { return }
        permissionRequested = true
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .badge, .sound],
        ) { granted, error in
            Task { @MainActor in
                self.permissionGranted = granted
                if let error {
                    logError("notif", "macOS requestAuthorization failed: \(error.localizedDescription)")
                } else {
                    logInfo("notif", "macOS notification permission granted=\(granted)")
                }
            }
        }
    }

    /// Fire a banner for a new chat / status / mention. No-op when the
    /// user is already viewing the channel in the active app window.
    func present(
        channel: String,
        title: String,
        body: String,
        eventId: String? = nil,
    ) {
        if shouldSuppress(channel: channel) { return }
        let content = UNMutableNotificationContent()
        content.title = title
        let trimmed = body.count > 240 ? String(body.prefix(237)) + "…" : body
        content.body = trimmed.isEmpty ? "(no content)" : trimmed
        content.sound = .default
        // threadIdentifier collapses multiple banners from the same channel
        // into a single Notification Center group, matching iOS behaviour.
        content.threadIdentifier = channel
        content.userInfo = [
            "channel": channel,
            "event_id": eventId ?? "",
        ]
        let request = UNNotificationRequest(
            identifier: eventId ?? UUID().uuidString,
            content: content,
            trigger: nil, // immediate
        )
        UNUserNotificationCenter.current().add(request) { error in
            if let error {
                logWarn("notif", "macOS banner add failed: \(error.localizedDescription)")
            }
        }
    }

    private func shouldSuppress(channel: String) -> Bool {
        guard NSApp.isActive else { return false }
        return currentVisibleChannel == channel
    }

}

extension MacNotifier: @preconcurrency UNUserNotificationCenterDelegate {
    /// The same suppression rule applies to foreground banners on macOS
    /// as on iOS: if the user is staring at the channel the banner is for,
    /// don't redraw what they already see. UN delivers these callbacks on
    /// the main queue, so the `@preconcurrency` conformance lets us keep
    /// the methods MainActor-isolated.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void,
    ) {
        let info = notification.request.content.userInfo
        let channel = info["channel"] as? String
        if let channel, shouldSuppress(channel: channel) {
            completionHandler([])
        } else {
            completionHandler([.banner, .sound, .badge])
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void,
    ) {
        let info = response.notification.request.content.userInfo
        if let channel = info["channel"] as? String {
            pendingDeepLinkChannel = channel
            NSApp.activate(ignoringOtherApps: true)
        }
        completionHandler()
    }
}
#endif
