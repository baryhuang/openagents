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
}
