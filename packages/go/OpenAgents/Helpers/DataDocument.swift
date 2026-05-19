import SwiftUI
import UniformTypeIdentifiers

/// Minimal `FileDocument` that wraps an in-memory `Data` blob so we can hand
/// arbitrary bytes to SwiftUI's `.fileExporter` modifier. We use this for the
/// content-sidebar download button — bytes come from the workspace API, we
/// don't need any document-model behavior, just "save these bytes to disk."
struct DataDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.data] }
    static var writableContentTypes: [UTType] { [.data] }

    var data: Data

    init(data: Data) {
        self.data = data
    }

    init(configuration: ReadConfiguration) throws {
        guard let bytes = configuration.file.regularFileContents else {
            throw CocoaError(.fileReadCorruptFile)
        }
        self.data = bytes
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}
