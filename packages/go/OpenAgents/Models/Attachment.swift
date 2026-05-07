import Foundation

/// A file the user has selected (or pasted) in the input bar but hasn't sent yet.
/// Held in chat-view state until the user hits send, at which point we upload it
/// and reference it in the outgoing message via a markdown link.
struct PendingAttachment: Identifiable, Sendable, Equatable {
    let id: UUID
    let filename: String
    let contentType: String
    let data: Data

    init(id: UUID = UUID(), filename: String, contentType: String, data: Data) {
        self.id = id
        self.filename = filename
        self.contentType = contentType
        self.data = data
    }

    var isImage: Bool { contentType.hasPrefix("image/") }
    var size: Int { data.count }
}
