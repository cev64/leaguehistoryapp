import SwiftUI

/// chat.js's `markdown()`, natively: the same small set of marks, read the
/// same way, line by line. Headings (any level) become one small title,
/// `---` a rule, a pipe table with its separator row a table, runs of `-`,
/// `*`, `•` or `1.` items a list, and anything else a paragraph whose lines
/// keep their breaks. Inline: `code`, **bold**, *italic* and _italic_.
enum ChatMarkdown {
    enum Block: Hashable {
        case heading(String)
        case rule
        case table(head: [String], rows: [[String]])
        case list(ordered: Bool, items: [String])
        case paragraph([String])
    }

    private static func matches(_ line: String, _ pattern: String) -> Bool {
        line.range(of: pattern, options: .regularExpression) != nil
    }

    private static let listItem = #"^\s*([-*•]|\d+[.)])\s+"#
    private static func isTableRow(_ line: String) -> Bool { matches(line, #"^\s*\|.*\|\s*$"#) }
    private static func cells(_ line: String) -> [String] {
        var s = line.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("|") { s.removeFirst() }
        if s.hasSuffix("|") { s.removeLast() }
        return s.split(separator: "|", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
    }

    static func blocks(_ source: String) -> [Block] {
        let lines = source.replacingOccurrences(of: "\r", with: "").components(separatedBy: "\n")
        var out: [Block] = []
        var i = 0
        while i < lines.count {
            let line = lines[i]
            if line.trimmingCharacters(in: .whitespaces).isEmpty { i += 1; continue }
            if let range = line.range(of: #"^#{1,4}\s+"#, options: .regularExpression) {
                out.append(.heading(String(line[range.upperBound...])))
                i += 1
                continue
            }
            if matches(line, #"^\s*(---|\*\*\*)\s*$"#) { out.append(.rule); i += 1; continue }
            if isTableRow(line), i + 1 < lines.count, matches(lines[i + 1], #"^\s*\|?[\s:-]+\|[\s|:-]*$"#) {
                let head = cells(line)
                i += 2
                var rows: [[String]] = []
                while i < lines.count, isTableRow(lines[i]) { rows.append(cells(lines[i])); i += 1 }
                out.append(.table(head: head, rows: rows))
                continue
            }
            if matches(line, listItem) {
                let ordered = matches(line, #"^\s*\d+[.)]\s+"#)
                var items: [String] = []
                while i < lines.count, matches(lines[i], listItem) {
                    items.append(lines[i].replacingOccurrences(of: listItem, with: "", options: .regularExpression))
                    i += 1
                }
                out.append(.list(ordered: ordered, items: items))
                continue
            }
            // A paragraph always takes its first line (a table row whose
            // separator hasn't streamed in yet reads as text for now).
            var para = [lines[i]]
            i += 1
            while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).isEmpty,
                  !matches(lines[i], #"^#{1,4}\s"#), !matches(lines[i], listItem), !isTableRow(lines[i]) {
                para.append(lines[i])
                i += 1
            }
            out.append(.paragraph(para))
        }
        return out
    }

    /// One line's inline marks.
    static func inline(_ text: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace,
                                                              failurePolicy: .returnPartiallyParsedIfPossible)
        var out = (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
        for run in out.runs {
            // Code spans in the league's soft grey, as the site's <code>.
            if run.inlinePresentationIntent?.contains(.code) == true {
                out[run.range].backgroundColor = Theme.surface3
            }
            // chat.js turns on no links: a [text](url) the AI writes reads
            // as its text, never a tappable address.
            if run.link != nil { out[run.range].link = nil }
            // Nor ~~strikethrough~~: the site shows the tildes' text plain.
            if run.inlinePresentationIntent?.contains(.strikethrough) == true {
                out[run.range].inlinePresentationIntent?.remove(.strikethrough)
            }
        }
        return out
    }
}

/// An answer, drawn from its Markdown.
struct ChatMarkdownView: View {
    let text: String
    /// The blinking caret at the end while the answer is being written.
    var caret = false

    var body: some View {
        let blocks = ChatMarkdown.blocks(text)
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                blockView(block, last: index == blocks.count - 1)
            }
            if caret, !(blocks.last.map(Self.takesCaret) ?? false) {
                Caret()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private static func takesCaret(_ block: ChatMarkdown.Block) -> Bool {
        if case .paragraph = block { return true }
        return false
    }

    @ViewBuilder
    private func blockView(_ block: ChatMarkdown.Block, last: Bool) -> some View {
        switch block {
        case .heading(let text):
            Text(ChatMarkdown.inline(text))
                .font(.display(17))
                .textCase(.uppercase)
                .tracking(0.5)
                .foregroundStyle(Theme.ink)
                .padding(.top, 2)
        case .rule:
            Rectangle().fill(Theme.line).frame(height: 1).padding(.vertical, 2)
        case .table(let head, let rows):
            ChatTable(head: head, rows: rows)
        case .list(let ordered, let items):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { n, item in
                    HStack(alignment: .firstTextBaseline, spacing: 7) {
                        Text(ordered ? "\(n + 1)." : "•")
                            .font(.subheadline.weight(.bold).monospacedDigit())
                            .foregroundStyle(Theme.accent)
                            .frame(minWidth: 14, alignment: .trailing)
                        Text(ChatMarkdown.inline(item))
                            .foregroundStyle(Theme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        case .paragraph(let lines):
            Text(paragraph(lines, caret: caret && last))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func paragraph(_ lines: [String], caret: Bool) -> AttributedString {
        var out = AttributedString()
        for (i, line) in lines.enumerated() {
            if i > 0 { out += AttributedString("\n") }
            out += ChatMarkdown.inline(line)
        }
        if caret {
            var mark = AttributedString(" ▍")
            mark.foregroundColor = Theme.accent
            out += mark
        }
        return out
    }
}

/// The caret on a line of its own, after a list or a table.
private struct Caret: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(Theme.accent)
            .frame(width: 7, height: 15)
            .phaseAnimator([1.0, 0.15]) { view, opacity in view.opacity(opacity) } animation: { _ in .easeInOut(duration: 0.5) }
    }
}

/// A table in an answer: a Grid, scrolling sideways when it's wider than
/// the bubble. The first column is the row's name, as on the site.
struct ChatTable: View {
    let head: [String]
    let rows: [[String]]

    private var columns: Int { max(head.count, rows.map(\.count).max() ?? 0) }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(0..<columns, id: \.self) { c in
                        Text(ChatMarkdown.inline(c < head.count ? head[c] : ""))
                            .font(.system(size: 10.5, weight: .semibold))
                            .tracking(0.4)
                            .textCase(.uppercase)
                            .foregroundStyle(Theme.ink3)
                            .lineLimit(1)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 7)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.surface2)
                    }
                }
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    Divider().overlay(Theme.line)
                    GridRow(alignment: .top) {
                        ForEach(0..<columns, id: \.self) { c in
                            Text(ChatMarkdown.inline(c < row.count ? row[c] : ""))
                                .font(.system(size: 12.5, weight: c == 0 ? .semibold : .regular).monospacedDigit())
                                .foregroundStyle(c == 0 ? Theme.ink : Theme.ink2)
                                .frame(maxWidth: 220, alignment: .leading)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.horizontal, 9)
                                .padding(.vertical, 7)
                        }
                    }
                }
            }
            // The frame hugs the table, however narrow, and scrolls with it
            // when it's wider than the bubble.
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Theme.line, lineWidth: 1))
            .padding(1)
        }
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        .padding(.vertical, 2)
    }
}
