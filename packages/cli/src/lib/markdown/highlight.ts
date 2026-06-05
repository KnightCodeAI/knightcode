/**
 * Lightweight, dependency-free syntax highlighter for fenced code blocks.
 *
 * It tokenizes a single line (the markdown renderer already splits blocks into
 * lines) into coloured spans. It's intentionally generic — tuned for C-family
 * and script languages rather than being grammar-accurate — so it stays offline
 * and cheap. Block constructs that span multiple lines (e.g. `/* … *\/`) are
 * only recognised within a line.
 */
export type TokenKind =
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "function"
  | "boolean"
  | "text";

export type Token = { text: string; kind: TokenKind };

/** Best-effort language hint from a file path's extension (for the tokenizer). */
export function langFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const ext = base.includes(".") ? base.split(".").pop()! : "";
  return ext.toLowerCase();
}

const KEYWORDS = new Set([
  // declarations / control flow shared across many languages
  "const", "let", "var", "function", "func", "fn", "def", "return", "if",
  "else", "elif", "for", "while", "do", "switch", "case", "default", "break",
  "continue", "class", "struct", "enum", "interface", "type", "trait", "impl",
  "extends", "implements", "import", "export", "from", "as", "new", "delete",
  "await", "async", "yield", "try", "catch", "finally", "throw", "typeof",
  "instanceof", "in", "of", "void", "this", "self", "super", "static", "public",
  "private", "protected", "readonly", "abstract", "get", "set", "package",
  "namespace", "module", "use", "mod", "pub", "match", "where", "go", "defer",
  "chan", "select", "range", "map", "lambda", "pass", "with", "raise", "except",
  "and", "or", "not", "end", "then", "begin", "when", "unless",
]);

const LITERALS = new Set([
  "true", "false", "null", "nil", "none", "undefined", "nan", "infinity",
  "True", "False", "None",
]);

const IDENT = /[A-Za-z_$][\w$]*/y;
const NUMBER = /0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?n?/y;
const WHITESPACE = /\s+/y;

function lineCommentPrefix(lang: string): string[] {
  const l = lang.toLowerCase();
  if (["py", "python", "sh", "bash", "shell", "zsh", "ruby", "rb", "yaml", "yml", "toml", "r"].includes(l)) {
    return ["#"];
  }
  if (["lua", "sql"].includes(l)) return ["--"];
  return ["//"]; // c-family default
}

/** Tokenize a single code line into coloured spans. */
export function tokenizeLine(line: string, lang = ""): Token[] {
  const tokens: Token[] = [];
  const commentPrefixes = lineCommentPrefix(lang);
  let i = 0;

  const push = (text: string, kind: TokenKind) => {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ text, kind });
  };

  while (i < line.length) {
    const rest = line.slice(i);

    // Line comments
    const cp = commentPrefixes.find((p) => rest.startsWith(p));
    if (cp) {
      push(line.slice(i), "comment");
      break;
    }
    // Single-line block comment
    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      const chunk = end >= 0 ? rest.slice(0, end + 2) : rest;
      push(chunk, "comment");
      i += chunk.length;
      continue;
    }

    const ch = line[i]!;

    // Strings (', ", `) — consume to the matching quote, honoring escapes.
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === "\\") {
          j += 2;
          continue;
        }
        if (line[j] === ch) {
          j++;
          break;
        }
        j++;
      }
      push(line.slice(i, j), "string");
      i = j;
      continue;
    }

    // Numbers
    NUMBER.lastIndex = i;
    const num = NUMBER.exec(line);
    if (num && num.index === i) {
      push(num[0], "number");
      i += num[0].length;
      continue;
    }

    // Identifiers / keywords / function calls
    IDENT.lastIndex = i;
    const id = IDENT.exec(line);
    if (id && id.index === i) {
      const word = id[0];
      let kind: TokenKind = "text";
      if (KEYWORDS.has(word)) kind = "keyword";
      else if (LITERALS.has(word)) kind = "boolean";
      else if (line[i + word.length] === "(") kind = "function";
      push(word, kind);
      i += word.length;
      continue;
    }

    // Whitespace / punctuation / operators fall through as plain text
    WHITESPACE.lastIndex = i;
    const ws = WHITESPACE.exec(line);
    if (ws && ws.index === i) {
      push(ws[0], "text");
      i += ws[0].length;
      continue;
    }

    push(ch, "text");
    i++;
  }

  return tokens;
}
