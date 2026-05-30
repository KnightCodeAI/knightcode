export function normalizeQuotes(str: string): string {
  return str
    .replaceAll("‘", "'")
    .replaceAll("’", "'")
    .replaceAll("“", '"')
    .replaceAll("”", '"');
}

export function findActualString(
  fileContent: string,
  searchString: string,
): string | null {
  if (fileContent.includes(searchString)) {
    return searchString;
  }

  const normalizedSearch = normalizeQuotes(searchString);
  const normalizedFile = normalizeQuotes(fileContent);
  const searchIndex = normalizedFile.indexOf(normalizedSearch);
  if (searchIndex !== -1) {
    return fileContent.substring(
      searchIndex,
      searchIndex + normalizedSearch.length,
    );
  }

  const lfSearch = searchString.replaceAll("\r\n", "\n");
  const lfFile = fileContent.replaceAll("\r\n", "\n");
  if (lfFile.includes(lfSearch)) {
    const lfIndex = lfFile.indexOf(lfSearch);
    let origIndex = 0;
    let lfPos = 0;
    while (lfPos < lfIndex) {
      if (
        fileContent[origIndex] === "\r" &&
        fileContent[origIndex + 1] === "\n"
      ) {
        origIndex += 2;
        lfPos += 1;
      } else {
        origIndex++;
        lfPos++;
      }
    }
    let endLfPos = lfPos;
    let endOrigIndex = origIndex;
    while (endLfPos < lfIndex + lfSearch.length) {
      if (
        fileContent[endOrigIndex] === "\r" &&
        fileContent[endOrigIndex + 1] === "\n"
      ) {
        endOrigIndex += 2;
        endLfPos += 1;
      } else {
        endOrigIndex++;
        endLfPos++;
      }
    }
    return fileContent.substring(origIndex, endOrigIndex);
  }

  return null;
}

export function preserveQuoteStyle(
  oldString: string,
  actualOldString: string,
  newString: string,
): string {
  if (oldString === actualOldString) return newString;

  const hasDoubleQuotes =
    actualOldString.includes("“") || actualOldString.includes("”");
  const hasSingleQuotes =
    actualOldString.includes("‘") || actualOldString.includes("’");
  if (!hasDoubleQuotes && !hasSingleQuotes) return newString;

  let result = newString;
  if (hasDoubleQuotes) {
    const chars = [...result];
    const out: string[] = [];
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === '"') {
        const prev = i > 0 ? chars[i - 1] : undefined;
        const isOpening =
          i === 0 ||
          prev === " " ||
          prev === "\t" ||
          prev === "\n" ||
          prev === "(" ||
          prev === "[" ||
          prev === "{";
        out.push(isOpening ? "“" : "”");
      } else {
        out.push(chars[i]!);
      }
    }
    result = out.join("");
  }
  if (hasSingleQuotes) {
    const chars = [...result];
    const out: string[] = [];
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === "'") {
        const prev = i > 0 ? chars[i - 1] : undefined;
        const next = i < chars.length - 1 ? chars[i + 1] : undefined;
        const prevIsLetter = prev !== undefined && /\p{L}/u.test(prev);
        const nextIsLetter = next !== undefined && /\p{L}/u.test(next);
        if (prevIsLetter && nextIsLetter) {
          out.push("’");
        } else {
          const isOpening =
            i === 0 ||
            prev === " " ||
            prev === "\t" ||
            prev === "\n" ||
            prev === "(" ||
            prev === "[" ||
            prev === "{";
          out.push(isOpening ? "‘" : "’");
        }
      } else {
        out.push(chars[i]!);
      }
    }
    result = out.join("");
  }
  return result;
}

export function stripTrailingWhitespace(
  str: string,
  isMarkdown: boolean,
): string {
  if (isMarkdown) return str;
  return str
    .split(/(\r\n|\n|\r)/)
    .map((part, i) => (i % 2 === 0 ? part.replace(/\s+$/, "") : part))
    .join("");
}

export function detectLineEnding(content: string): "\r\n" | "\n" {
  const crlfCount = (content.match(/\r\n/g) || []).length;
  const lfCount = (content.match(/(?<!\r)\n/g) || []).length;
  return crlfCount > lfCount ? "\r\n" : "\n";
}
