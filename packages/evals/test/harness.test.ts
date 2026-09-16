import { homedir } from "node:os";
import { getDocsPath, getExamplesPath, getReadmePath } from "@knightcodeai/cli";
import { describe, expect, it, vi } from "vitest";
import { buildSystemPrompt } from "../../cli/src/core/system-prompt.ts";
import {
	applyIsolatedEnvironment,
	createDocumentationEvalHarness,
	DOCUMENTATION_EVAL_TOOLS,
	excludeDocumentation,
	resolveDocumentationVariant,
	resolveModelSelection,
} from "../src/harness.ts";

describe("resolveModelSelection", () => {
	it("prefers an explicit harness model", () => {
		expect(
			resolveModelSelection(
				{ provider: "anthropic", id: "claude-opus-4-6" },
				{ KNIGHTCODE_PROVIDER: "openai-codex", KNIGHTCODE_MODEL: "gpt-5.6-sol" },
			),
		).toEqual({ provider: "anthropic", id: "claude-opus-4-6" });
	});

	it("uses trimmed environment defaults", () => {
		expect(
			resolveModelSelection(undefined, { KNIGHTCODE_PROVIDER: " openai-codex ", KNIGHTCODE_MODEL: " gpt-5.6-sol " }),
		).toEqual({
			provider: "openai-codex",
			id: "gpt-5.6-sol",
		});
	});

	it.each([{}, { KNIGHTCODE_PROVIDER: "openai-codex" }, { KNIGHTCODE_MODEL: "gpt-5.6-sol" }])(
		"rejects incomplete model selection",
		(environment) => {
			expect(() => resolveModelSelection(undefined, environment)).toThrow("Select a harness model explicitly");
		},
	);
});

describe("isolateProcessEnvironment", () => {
	it("removes runner metadata and restores the process environment", () => {
		vi.stubEnv("KNIGHTCODE_EVAL_VARIANT", "with_docs");
		vi.stubEnv("KNIGHTCODE_EVAL_ARTIFACT_DIR", "/tmp/artifacts");
		const oldHome = process.env.HOME;
		try {
			const restore = applyIsolatedEnvironment("/tmp/eval-home", "/tmp/eval-agent");
			try {
				expect(homedir()).toBe("/tmp/eval-home");
				expect(process.env.KNIGHTCODE_CODING_AGENT_DIR).toBe("/tmp/eval-agent");
				expect(process.env.KNIGHTCODE_EVAL_VARIANT).toBeUndefined();
				expect(process.env.KNIGHTCODE_EVAL_ARTIFACT_DIR).toBeUndefined();
			} finally {
				restore();
			}
			expect(process.env.HOME).toBe(oldHome);
			expect(process.env.KNIGHTCODE_EVAL_VARIANT).toBe("with_docs");
		} finally {
			vi.unstubAllEnvs();
		}
	});
});

describe("documentation variant", () => {
	it.each(["without_docs", "with_docs"] as const)("accepts %s", (variant) => {
		expect(resolveDocumentationVariant(variant)).toBe(variant);
	});

	it.each([undefined, "", "other"])("rejects invalid variant %s", (variant) => {
		expect(() => resolveDocumentationVariant(variant)).toThrow("KNIGHTCODE_EVAL_VARIANT");
	});

	it("strips only the documentation routing section from the default KnightCode prompt", () => {
		const prompt = buildSystemPrompt({
			cwd: "/workspace",
			selectedTools: [...DOCUMENTATION_EVAL_TOOLS],
		});
		expect(prompt).toContain("\n<docs>\nKnightCode documentation (read only");
		expect(prompt).toContain("\n<rules>\n");
		expect(prompt).toContain("\n<cwd>\n/workspace\n</cwd>");
		expect(prompt).toContain("docs/models.md");

		const stripped = excludeDocumentation(prompt);
		expect(stripped).toContain("\n<rules>\n");
		expect(stripped).toContain("\n<cwd>\n/workspace\n</cwd>");
		expect(stripped).not.toContain("<docs>");
		expect(stripped).not.toContain("KnightCode documentation");
		expect(stripped).not.toContain("docs/models.md");
		expect(stripped).not.toContain(getReadmePath());
		expect(stripped).not.toContain(getDocsPath());
		expect(stripped).not.toContain(getExamplesPath());
	});

	it("fails closed when prompt markers are missing", () => {
		expect(() => excludeDocumentation("Instructions")).toThrow("no KnightCode documentation section");
		expect(() => excludeDocumentation("\n<docs>\nPi documentation\n</docs>")).toThrow("no working-directory section");
	});

	it("names the documentation harness after the variant it runs", () => {
		vi.stubEnv("KNIGHTCODE_EVAL_VARIANT", "without_docs");
		try {
			expect(createDocumentationEvalHarness().name).toBe("without_docs");
		} finally {
			vi.unstubAllEnvs();
		}
	});
});
