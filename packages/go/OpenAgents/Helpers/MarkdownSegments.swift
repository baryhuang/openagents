import Foundation

/// Lightweight parser that splits a message into prose and fenced code blocks.
/// Inline markdown (bold/italic/code/links) is left to SwiftUI's built-in
/// LocalizedStringKey-based markdown rendering — this only handles ``` fences.
enum MarkdownSegment: Equatable, Sendable {
    case prose(String)
    case code(language: String?, content: String)
}

enum MarkdownSegmenter {
    /// Split content on ```fences. Always returns at least one segment.
    static func segments(in content: String) -> [MarkdownSegment] {
        guard content.contains("```") else { return [.prose(content)] }

        var result: [MarkdownSegment] = []
        var remaining = content[...]

        while let fenceStart = remaining.range(of: "```") {
            // Prose before the fence
            let prose = String(remaining[..<fenceStart.lowerBound])
            if !prose.isEmpty {
                result.append(.prose(prose))
            }

            let afterOpen = fenceStart.upperBound
            // Read until end of line for an optional language tag
            let restAfterOpen = remaining[afterOpen...]
            let newlineRange = restAfterOpen.firstIndex(of: "\n")
            let langEnd = newlineRange ?? restAfterOpen.endIndex
            let language = String(restAfterOpen[..<langEnd]).trimmingCharacters(in: .whitespaces)
            let codeStart = newlineRange.map { restAfterOpen.index(after: $0) } ?? langEnd

            // Find closing fence
            let codeArea = remaining[codeStart...]
            if let closeRange = codeArea.range(of: "```") {
                let code = String(codeArea[..<closeRange.lowerBound])
                let trimmedCode = code.hasSuffix("\n") ? String(code.dropLast()) : code
                result.append(.code(language: language.isEmpty ? nil : language, content: trimmedCode))
                remaining = remaining[closeRange.upperBound...]
            } else {
                // Unterminated fence — treat the rest as code
                result.append(.code(language: language.isEmpty ? nil : language, content: String(codeArea)))
                remaining = remaining[remaining.endIndex...]
            }
        }

        let trailing = String(remaining)
        if !trailing.isEmpty {
            result.append(.prose(trailing))
        }
        return result.isEmpty ? [.prose(content)] : result
    }
}
