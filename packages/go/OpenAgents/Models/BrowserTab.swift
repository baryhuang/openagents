import Foundation

/// A browser tab opened by an agent via Browser Fabric. We mirror the
/// `_tab_to_dict` shape from `workspace/backend/app/routers/browser.py`:
///
/// ```
/// {
///   "id": "...",
///   "url": "https://...",
///   "title": "...",
///   "live_url": "https://...",   // populated while the session is live
///   "session_id": "...",         // Browser Fabric session id
///   "agent_name": "...",         // who opened it (often nil)
///   "created_at": "...",
///   "updated_at": "..."
/// }
/// ```
///
/// v1 of the Go viewer only needs `liveUrl` to render the embedded viewer —
/// the rest is for header chrome and ordering. Multi-tab management is
/// deliberately out of scope; the store picks the most-recent live tab.
struct BrowserTab: Identifiable, Decodable, Sendable, Equatable {
    let id: String
    let url: String?
    let title: String?
    let liveUrl: String?
    let sessionId: String?
    let agentName: String?
    let createdAt: String?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case url
        case title
        case liveUrl = "live_url"
        case sessionId = "session_id"
        case agentName = "agent_name"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    /// True when the backend has handed us a live URL we can embed. Multiple
    /// historical tabs may exist; the panel only renders ones for which
    /// `isLive` is true.
    var isLive: Bool {
        guard let liveUrl, !liveUrl.isEmpty else { return false }
        return true
    }

    /// Best-effort timestamp for sorting "most recent" — falls back to
    /// `createdAt`. `Date.distantPast` for rows the backend left without
    /// either field so they sort to the bottom.
    var sortKey: Date {
        if let updatedAt, let d = Self.parseISO8601(updatedAt) { return d }
        if let createdAt, let d = Self.parseISO8601(createdAt) { return d }
        return .distantPast
    }

    private static func parseISO8601(_ raw: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: raw) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: raw)
    }
}
