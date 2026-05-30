/**
 * Semantic color keys — resolved to theme colors by MarkdownText.
 *   "primary"  → colors.primary   (h1, h4, table headers)
 *   "info"     → colors.info      (h2)
 *   "thinking" → colors.thinking  (h3)
 *   "dim"      → colors.dimSeparator (blockquotes, hr, table rules)
 *   "code"     → colors.info      (fenced code blocks)
 *   "text"     → caller-supplied defaultFg (normal prose, table data)
 */
export type MdColor = "primary" | "info" | "thinking" | "dim" | "text" | "code";

export type RenderedLine = {
  text: string;
  fg: MdColor;
  bold: boolean;
  dim: boolean;
};

type Align = "left" | "center" | "right";

function parseTableRow(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function detectAlign(cells: string[]): Align[] {
  return cells.map((c) => {
    if (c.startsWith(":") && c.endsWith(":")) return "center";
    if (c.endsWith(":")) return "right";
    return "left";
  });
}

function padCell(text: string, width: number, align: Align): string {
  const pad = Math.max(0, width - text.length);
  if (align === "right") return " ".repeat(pad) + text;
  if (align === "center") {
    const l = Math.floor(pad / 2);
    return " ".repeat(l) + text + " ".repeat(pad - l);
  }
  return text + " ".repeat(pad);
}

function renderTable(rows: string[]): RenderedLine[] {
  if (rows.length === 0) return [];

  const parsed = rows.map(parseTableRow);
  const sepIdx = parsed.findIndex(isSeparatorRow);

  const headerRows = sepIdx > 0 ? parsed.slice(0, sepIdx) : [];
  const aligns: Align[] = sepIdx >= 0 ? detectAlign(parsed[sepIdx]!) : [];
  const dataRows = sepIdx >= 0 ? parsed.slice(sepIdx + 1) : parsed;

  const allContent = [...headerRows, ...dataRows];
  if (allContent.length === 0) return [];

  const colCount = Math.max(...allContent.map((r) => r.length));
  while (aligns.length < colCount) aligns.push("left");

  const colWidths = Array.from({ length: colCount }, (_, i) =>
    Math.max(...allContent.map((r) => stripInline(r[i] ?? "").length), 1),
  );

  // " cell  cell  cell " — 1 leading space + cells joined by "  " + 1 trailing space
  const totalWidth =
    1 + colWidths.reduce((s, w) => s + w, 0) + (colCount - 1) * 2 + 1;

  const renderRow = (row: string[]): string =>
    " " +
    Array.from({ length: colCount }, (_, i) =>
      padCell(stripInline(row[i] ?? ""), colWidths[i]!, aligns[i]!),
    ).join("  ") +
    " ";

  const out: RenderedLine[] = [];

  for (const row of headerRows) {
    out.push({ text: renderRow(row), fg: "primary", bold: true, dim: false });
  }

  if (headerRows.length > 0) {
    out.push({
      text: "─".repeat(totalWidth),
      fg: "dim",
      bold: false,
      dim: true,
    });
  }

  for (const row of dataRows) {
    out.push({ text: renderRow(row), fg: "text", bold: false, dim: false });
  }

  return out;
}

/**
 * Converts a markdown string into terminal-renderable lines.
 * Handles: h1-h4, fenced code blocks, inline code, blockquotes,
 * unordered + ordered lists, bold/italic/links (stripped), hr, tables.
 */
export function renderMarkdownLines(md: string): RenderedLine[] {
  const rawLines = md.split("\n");
  const out: RenderedLine[] = [];
  let inCode = false;
  const tableBuffer: string[] = [];

  function flushTable() {
    if (tableBuffer.length === 0) return;
    out.push(...renderTable(tableBuffer));
    tableBuffer.length = 0;
  }

  for (const raw of rawLines) {
    // Fenced code block boundary — consume the fence line silently
    if (/^```/.test(raw)) {
      flushTable();
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      out.push({ text: raw, fg: "code", bold: false, dim: false });
      continue;
    }

    // Table row — buffer for multi-line width calculation
    if (/^\|/.test(raw)) {
      tableBuffer.push(raw);
      continue;
    }

    // Any non-table line flushes a pending table
    flushTable();

    // Horizontal rule
    if (/^(-{3,}|={3,}|\*{3,})\s*$/.test(raw.trim())) {
      out.push({ text: "─".repeat(60), fg: "dim", bold: false, dim: true });
      continue;
    }

    // Headings
    const h1 = raw.match(/^# (.+)$/);
    if (h1) {
      out.push({
        text: h1[1]!.toUpperCase(),
        fg: "primary",
        bold: true,
        dim: false,
      });
      continue;
    }

    const h2 = raw.match(/^## (.+)$/);
    if (h2) {
      out.push({ text: "▸ " + h2[1]!, fg: "info", bold: true, dim: false });
      continue;
    }

    const h3 = raw.match(/^### (.+)$/);
    if (h3) {
      out.push({
        text: "  › " + h3[1]!,
        fg: "thinking",
        bold: true,
        dim: false,
      });
      continue;
    }

    const h4 = raw.match(/^#{4,} (.+)$/);
    if (h4) {
      out.push({
        text: "    " + h4[1]!,
        fg: "primary",
        bold: true,
        dim: false,
      });
      continue;
    }

    // Blockquote
    const bq = raw.match(/^> ?(.*)$/);
    if (bq) {
      out.push({
        text: "│ " + stripInline(bq[1] ?? ""),
        fg: "dim",
        bold: false,
        dim: true,
      });
      continue;
    }

    // Unordered list
    const ul = raw.match(/^(\s*)[*\-+] (.+)$/);
    if (ul) {
      const depth = (ul[1] ?? "").length;
      const bullet = depth > 0 ? "  ◦ " : "• ";
      out.push({
        text: " ".repeat(depth) + bullet + stripInline(ul[2] ?? ""),
        fg: "text",
        bold: false,
        dim: false,
      });
      continue;
    }

    // Ordered list
    const ol = raw.match(/^(\s*)(\d+)\. (.+)$/);
    if (ol) {
      out.push({
        text:
          " ".repeat((ol[1] ?? "").length) +
          ol[2]! +
          ". " +
          stripInline(ol[3] ?? ""),
        fg: "text",
        bold: false,
        dim: false,
      });
      continue;
    }

    // Empty line
    if (raw.trim() === "") {
      out.push({ text: "", fg: "text", bold: false, dim: false });
      continue;
    }

    // Regular text
    out.push({ text: stripInline(raw), fg: "text", bold: false, dim: false });
  }

  // Flush any table that ends at EOF
  flushTable();

  return out;
}

/** Strip inline markers: **bold**, *italic*, `code`, [text](url), ~~strike~~ */
function stripInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[(.+?)\]\([^)]*\)/g, "$1")
    .replace(/~~(.+?)~~/g, "$1");
}
