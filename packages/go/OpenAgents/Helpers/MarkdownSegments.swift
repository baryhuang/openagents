import Foundation

/// Lightweight parser that splits a message into prose, fenced code blocks,
/// fenced HTML blocks (rendered as interactive web views), and GFM-style
/// tables. Inline markdown (bold/italic/links/inline-code) is left to
/// SwiftUI's built-in LocalizedStringKey rendering on each prose chunk.
enum MarkdownSegment: Equatable, Sendable {
    case prose(String)
    case code(language: String?, content: String)
    /// A fenced \`\`\`html block — rendered as a sandboxed WKWebView rather
    /// than monospace source. The string is the raw HTML inside the fence.
    case htmlBlock(String)
    case table(headers: [String], rows: [[String]], alignments: [MarkdownTableAlignment])
}

enum MarkdownTableAlignment: Equatable, Sendable {
    case leading, center, trailing
}

enum MarkdownSegmenter {
    /// Walk the content line by line, splitting out fenced code blocks and
    /// GFM tables. Anything else is collected into prose runs.
    static func segments(in content: String) -> [MarkdownSegment] {
        let lines = content.components(separatedBy: "\n")
        var result: [MarkdownSegment] = []
        var proseBuffer: [String] = []

        func flushProse() {
            guard !proseBuffer.isEmpty else { return }
            // Drop a single trailing empty line so spacing between block elements
            // doesn't double up. Internal blanks (paragraph breaks) are kept.
            if proseBuffer.last == "" { proseBuffer.removeLast() }
            let text = proseBuffer.joined(separator: "\n")
            if !text.isEmpty { result.append(.prose(text)) }
            proseBuffer = []
        }

        var i = 0
        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            // ``` fence
            if trimmed.hasPrefix("```") {
                flushProse()
                let lang = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                var codeLines: [String] = []
                i += 1
                while i < lines.count {
                    if lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                        i += 1
                        break
                    }
                    codeLines.append(lines[i])
                    i += 1
                }
                let content = codeLines.joined(separator: "\n")
                // Route `html` fences to the WebView segment. Everything else
                // (including `htm`, `xml`, etc.) stays as a code block — we
                // want the rendered preview only for explicit `html` so authors
                // who really want to *show* the source can still use ```xml or
                // a plain ```code fence.
                if lang.lowercased() == "html" {
                    result.append(.htmlBlock(content))
                } else {
                    result.append(.code(language: lang.isEmpty ? nil : lang, content: content))
                }
                continue
            }

            // GFM table: a row containing `|` followed by a separator row.
            if line.contains("|"),
               i + 1 < lines.count,
               isSeparatorRow(lines[i + 1]) {
                flushProse()
                let headers = parseRow(line)
                let alignments = parseAlignments(lines[i + 1], columnCount: headers.count)
                i += 2
                var rows: [[String]] = []
                while i < lines.count {
                    let r = lines[i]
                    let rt = r.trimmingCharacters(in: .whitespaces)
                    if rt.isEmpty || !rt.contains("|") { break }
                    rows.append(parseRow(r, columnCount: headers.count))
                    i += 1
                }
                result.append(.table(headers: headers, rows: rows, alignments: alignments))
                continue
            }

            proseBuffer.append(line)
            i += 1
        }
        flushProse()

        return result.isEmpty ? [.prose(content)] : result
    }

    // MARK: - Table helpers

    /// `| --- | :---: | ---: |` and the like. Each cell must match `:?-+:?`.
    private static func isSeparatorRow(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.contains("-"), trimmed.contains("|") else { return false }
        let cells = parseRow(trimmed)
        guard !cells.isEmpty else { return false }
        for cell in cells where cell.range(of: "^:?-{2,}:?$", options: .regularExpression) == nil {
            return false
        }
        return true
    }

    /// Split `| a | b | c |` into ["a", "b", "c"], stripping the optional outer pipes.
    private static func parseRow(_ line: String, columnCount: Int? = nil) -> [String] {
        var trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("|") { trimmed.removeFirst() }
        if trimmed.hasSuffix("|") { trimmed.removeLast() }
        var cells = trimmed.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
        if let n = columnCount {
            if cells.count < n { cells.append(contentsOf: Array(repeating: "", count: n - cells.count)) }
            if cells.count > n { cells = Array(cells.prefix(n)) }
        }
        return cells
    }

    private static func parseAlignments(_ line: String, columnCount: Int) -> [MarkdownTableAlignment] {
        let cells = parseRow(line, columnCount: columnCount)
        return cells.map { cell in
            let leftColon = cell.hasPrefix(":")
            let rightColon = cell.hasSuffix(":")
            switch (leftColon, rightColon) {
            case (true, true):  return .center
            case (false, true): return .trailing
            default:            return .leading
            }
        }
    }
}
