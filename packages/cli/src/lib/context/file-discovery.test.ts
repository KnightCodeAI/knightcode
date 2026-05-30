import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";
import {
  stripHtmlComments,
  resolveIncludePaths,
  processFileWithIncludes,
  listMarkdownFiles,
  listMarkdownFilesRecursive,
  findGitRoot,
} from "./file-discovery";

// Use a temp directory within the workspace for tests
const TEST_ROOT = resolve(__dirname, "__test_file_discovery__");

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

function writeFile(path: string, content: string) {
  ensureDir(join(path, ".."));
  writeFileSync(path, content, "utf-8");
}

describe("file-discovery", () => {
  beforeEach(() => {
    ensureDir(TEST_ROOT);
  });

  afterEach(() => {
    if (existsSync(TEST_ROOT)) {
      rmSync(TEST_ROOT, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // stripHtmlComments
  // -----------------------------------------------------------------------
  describe("stripHtmlComments", () => {
    it("returns unchanged content when no comments", () => {
      const input = "Hello world\nNo comments here";
      const result = stripHtmlComments(input);
      expect(result.content).toBe(input);
      expect(result.stripped).toBe(false);
    });

    it("strips a single-line block comment", () => {
      const input = "Before\n<!-- this is a comment -->\nAfter";
      const result = stripHtmlComments(input);
      expect(result.content).toBe("Before\nAfter");
      expect(result.stripped).toBe(true);
    });

    it("strips a multi-line block comment", () => {
      const input = "Before\n<!-- start\nmiddle\nend -->\nAfter";
      const result = stripHtmlComments(input);
      expect(result.content).toBe("Before\nAfter");
      expect(result.stripped).toBe(true);
    });

    it("preserves comments inside fenced code blocks", () => {
      const input = "Before\n```\n<!-- not stripped -->\n```\nAfter";
      const result = stripHtmlComments(input);
      expect(result.content).toBe(input);
      expect(result.stripped).toBe(false);
    });

    it("keeps content after closing -->", () => {
      const input = "<!-- comment --> Keep this";
      const result = stripHtmlComments(input);
      expect(result.content).toBe("Keep this");
      expect(result.stripped).toBe(true);
    });

    it("handles multiple comments", () => {
      const input = "A\n<!-- c1 -->\nB\n<!-- c2 -->\nC";
      const result = stripHtmlComments(input);
      expect(result.content).toBe("A\nB\nC");
      expect(result.stripped).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // resolveIncludePaths
  // -----------------------------------------------------------------------
  describe("resolveIncludePaths", () => {
    it("extracts @./relative paths", () => {
      const content = "Include this: @./rules/extra.md";
      const result = resolveIncludePaths(content, "/project");
      expect(result).toContainEqual(resolve("/project", "rules/extra.md"));
    });

    it("extracts @path without prefix (treated as relative)", () => {
      const content = "Use @config.md for settings";
      const result = resolveIncludePaths(content, "/project");
      expect(result).toContainEqual(resolve("/project", "config.md"));
    });

    it("skips paths inside inline code", () => {
      const content = "Use `@not-included.md` but @included.md";
      const result = resolveIncludePaths(content, "/project");
      expect(result.some((p) => p.includes("not-included"))).toBe(false);
      expect(result.some((p) => p.includes("included.md"))).toBe(true);
    });

    it("skips paths inside fenced code blocks", () => {
      const content = "```\n@not-included.md\n```\n@included.md";
      const result = resolveIncludePaths(content, "/project");
      expect(result.some((p) => p.includes("not-included"))).toBe(false);
      expect(result.some((p) => p.includes("included.md"))).toBe(true);
    });

    it("strips fragment identifiers", () => {
      const content = "@./file.md#section";
      const result = resolveIncludePaths(content, "/project");
      expect(result[0]).toBe(resolve("/project", "file.md"));
    });

    it("returns empty array when no @includes", () => {
      const content = "No includes here, just @ symbol and email@test.com";
      const result = resolveIncludePaths(content, "/project");
      // email-like patterns should not produce results matching "email"
      // The regex requires whitespace before @, so email@test.com won't match
      expect(result.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // processFileWithIncludes
  // -----------------------------------------------------------------------
  describe("processFileWithIncludes", () => {
    it("reads a single file", () => {
      const filePath = join(TEST_ROOT, "single.md");
      writeFile(filePath, "Hello world");
      const result = processFileWithIncludes(filePath);
      expect(result).toBe("Hello world");
    });

    it("strips HTML comments from file content", () => {
      const filePath = join(TEST_ROOT, "commented.md");
      writeFile(filePath, "Before\n<!-- comment -->\nAfter");
      const result = processFileWithIncludes(filePath);
      expect(result).toBe("Before\nAfter");
    });

    it("resolves @include directives", () => {
      const mainFile = join(TEST_ROOT, "main.md");
      const includedFile = join(TEST_ROOT, "included.md");
      writeFile(includedFile, "Included content");
      writeFile(mainFile, "Main content\n@./included.md");
      const result = processFileWithIncludes(mainFile);
      expect(result).toContain("Main content");
      expect(result).toContain("Included content");
    });

    it("prevents circular references", () => {
      const fileA = join(TEST_ROOT, "a.md");
      const fileB = join(TEST_ROOT, "b.md");
      writeFile(fileA, "A\n@./b.md");
      writeFile(fileB, "B\n@./a.md");
      // Should not infinite loop — returns content from both without re-processing
      const result = processFileWithIncludes(fileA);
      expect(result).toContain("A");
      expect(result).toContain("B");
    });

    it("respects max include depth", () => {
      // Create a chain deeper than MAX_INCLUDE_DEPTH (5)
      for (let i = 0; i < 8; i++) {
        const content =
          i < 7 ? `Level ${i}\n@./level${i + 1}.md` : `Level ${i}`;
        writeFile(join(TEST_ROOT, `level${i}.md`), content);
      }
      const result = processFileWithIncludes(join(TEST_ROOT, "level0.md"));
      expect(result).toContain("Level 0");
      expect(result).toContain("Level 4"); // depth 4 is within limit
      // Level 5+ might not be included due to depth limit
    });

    it("returns empty for non-text file extensions", () => {
      const filePath = join(TEST_ROOT, "image.png");
      writeFile(filePath, "not real png data");
      const result = processFileWithIncludes(filePath);
      expect(result).toBe("");
    });

    it("returns empty for non-existent files", () => {
      const result = processFileWithIncludes(join(TEST_ROOT, "nonexistent.md"));
      expect(result).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // listMarkdownFiles
  // -----------------------------------------------------------------------
  describe("listMarkdownFiles", () => {
    it("returns .md files in a flat directory", () => {
      ensureDir(join(TEST_ROOT, "flat"));
      writeFile(join(TEST_ROOT, "flat", "a.md"), "A");
      writeFile(join(TEST_ROOT, "flat", "b.md"), "B");
      writeFile(join(TEST_ROOT, "flat", "c.txt"), "C");

      const result = listMarkdownFiles(join(TEST_ROOT, "flat"));
      expect(result.length).toBe(2);
      expect(result.some((p) => p.endsWith("a.md"))).toBe(true);
      expect(result.some((p) => p.endsWith("b.md"))).toBe(true);
    });

    it("does NOT recurse into subdirectories", () => {
      ensureDir(join(TEST_ROOT, "flat2", "sub"));
      writeFile(join(TEST_ROOT, "flat2", "top.md"), "Top");
      writeFile(join(TEST_ROOT, "flat2", "sub", "nested.md"), "Nested");

      const result = listMarkdownFiles(join(TEST_ROOT, "flat2"));
      expect(result.length).toBe(1);
      expect(result[0]).toContain("top.md");
    });

    it("returns empty for non-existent directory", () => {
      expect(listMarkdownFiles(join(TEST_ROOT, "nope"))).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // listMarkdownFilesRecursive
  // -----------------------------------------------------------------------
  describe("listMarkdownFilesRecursive", () => {
    it("recursively finds .md files in subdirectories", () => {
      ensureDir(join(TEST_ROOT, "rec", "sub1", "sub2"));
      writeFile(join(TEST_ROOT, "rec", "a.md"), "A");
      writeFile(join(TEST_ROOT, "rec", "sub1", "b.md"), "B");
      writeFile(join(TEST_ROOT, "rec", "sub1", "sub2", "c.md"), "C");
      writeFile(join(TEST_ROOT, "rec", "sub1", "ignore.txt"), "D");

      const result = listMarkdownFilesRecursive(join(TEST_ROOT, "rec"));
      expect(result.length).toBe(3);
      expect(result.some((p) => p.endsWith("a.md"))).toBe(true);
      expect(result.some((p) => p.endsWith("b.md"))).toBe(true);
      expect(result.some((p) => p.endsWith("c.md"))).toBe(true);
    });

    it("returns empty for non-existent directory", () => {
      expect(listMarkdownFilesRecursive(join(TEST_ROOT, "nope"))).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // findGitRoot
  // -----------------------------------------------------------------------
  describe("findGitRoot", () => {
    it("returns a path for a directory inside a git repo", () => {
      // The knightcode project itself is a git repo
      const root = findGitRoot(resolve(__dirname));
      expect(root).not.toBeNull();
      expect(typeof root).toBe("string");
    });
  });
});
