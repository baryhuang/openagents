import Foundation

/// A chat message rendered in the conversation view.
struct Message: Identifiable, Sendable, Equatable {
    let messageId: String
    let sessionId: String
    /// "human" or "agent".
    let senderType: String
    let senderName: String
    let content: String
    let mentions: [String]
    /// "chat", "status", "thinking", etc.
    let messageType: String
    /// Unix milliseconds.
    let timestamp: Int64

    var id: String { messageId }
    var isFromUser: Bool { senderType == "human" }
    var isStatus: Bool { messageType == "status" || messageType == "thinking" }
    var date: Date { Date(timeIntervalSince1970: TimeInterval(timestamp) / 1000.0) }

    /// Synthesize a local "Stopping..." status row used as an optimistic UI
    /// update when the user taps Stop. The next real status from the backend
    /// overwrites it via the normal message-poll path.
    static func localStoppingStatus(channel: String) -> Message {
        Message(
            messageId: "local-stopping-\(Int(Date().timeIntervalSince1970 * 1000))",
            sessionId: channel,
            senderType: "agent",
            senderName: "system",
            content: "Stopping...",
            mentions: [],
            messageType: "status",
            timestamp: Int64(Date().timeIntervalSince1970 * 1000),
        )
    }
}
