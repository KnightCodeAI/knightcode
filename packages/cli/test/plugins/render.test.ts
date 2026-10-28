import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPlugin } from "../../src/plugins/manifest.ts";
import { pluginServerName, renderPlugin } from "../../src/plugins/render.ts";
import { parseFrontmatter } from "../../src/utils/frontmatter.ts";
import { useTempDirs, writeTree } from "./helpers.ts";

const tempDir = useTempDirs();
const FINAL = "C:\\agent\\plugins\\cache\\p-1\\rev\\plugin";
const DATA = "C:\\agent\\plugins\\data\\p-1";
const FINAL_POSIX = "C:/agent/plugins/cache/p-1/rev/plugin";
const DATA_POSIX = "C:/agent/plugins/data/p-1";

function render(files: Record<string, string | object>) {
	const root = writeTree(tempDir(), files);
	const inventory = renderPlugin(loadPlugin(root), { root: FINAL, dataDir: DATA });
	return { root, inventory, read: (path: string) => readFileSync(join(root, path), "utf-8") };
}

describe("plugin rendering", () => {
	it("substitutes root, data and skill-directory tokens with absolute forward-slash paths", () => {
		const { read } = render({
			"plugin.json": { name: "p" },
			"skills/fmt/SKILL.md":
				"---\ndescription: Format\n---\nRun ${CLAUDE_PLUGIN_ROOT}/scripts/x.py and ${GROK_PLUGIN_ROOT}/y with ${CLAUDE_PLUGIN_DATA} ${GROK_PLUGIN_DATA} in ${CLAUDE_SKILL_DIR} or ${SKILL_DIR}. Also ../../scripts/x.py\n",
			"commands/go.md": "Go to ${CLAUDE_PLUGIN_ROOT} and ${SKILL_DIR}\n",
		});
		const body = parseFrontmatter(read("skills/fmt/SKILL.md")).body;
		expect(body).toBe(
			`Run ${FINAL_POSIX}/scripts/x.py and ${FINAL_POSIX}/y with ${DATA_POSIX} ${DATA_POSIX} in ${FINAL_POSIX}/skills/fmt or ${FINAL_POSIX}/skills/fmt. Also ../../scripts/x.py`,
		);
		// ${SKILL_DIR} means nothing in a command and stays literal.
		expect(read("commands/go.md")).toBe(`Go to ${FINAL_POSIX} and \${SKILL_DIR}\n`);
	});

	it("names skills <plugin>:<skill> and fills in a missing description", () => {
		const { read, inventory } = render({
			"plugin.json": { name: "Tool_Kit", skills: ["./skills", "./extra/solo.md"] },
			"skills/from-paragraph/SKILL.md": "# Title\n\nFirst paragraph\nspans lines.\n\nSecond.\n",
			"skills/from-heading/SKILL.md": "---\nname: Heading One\n---\n# Only a heading\n",
			"skills/bare/SKILL.md": "",
			"extra/solo.md": "---\ndescription: Solo skill\n---\nbody\n",
		});
		const frontmatter = (path: string) => parseFrontmatter<Record<string, unknown>>(read(path)).frontmatter;
		expect(frontmatter("skills/from-paragraph/SKILL.md")).toMatchObject({
			name: "tool-kit:from-paragraph",
			description: "First paragraph spans lines.",
		});
		expect(frontmatter("skills/from-heading/SKILL.md")).toMatchObject({
			name: "tool-kit:heading-one",
			description: "Only a heading",
		});
		expect(frontmatter("skills/bare/SKILL.md")).toMatchObject({ name: "tool-kit:bare", description: "bare" });
		expect(inventory.skills.map((skill) => [skill.name, skill.file])).toEqual([
			["tool-kit:bare", "skills/bare/SKILL.md"],
			["tool-kit:heading-one", "skills/from-heading/SKILL.md"],
			["tool-kit:from-paragraph", "skills/from-paragraph/SKILL.md"],
			["tool-kit:solo", "extra/solo.md"],
		]);
	});

	it("records commands from directories, files and inline content", () => {
		const { inventory } = render({
			"plugin.json": {
				name: "p",
				commands: {
					inline: { content: "Hello ${CLAUDE_PLUGIN_ROOT}", description: "Inline" },
					filed: { source: "./c/filed.md", "argument-hint": "<x>" },
				},
			},
			"c/filed.md": "---\narguments: [target, mode]\n---\nDo $target\n",
		});
		expect(inventory.commands).toEqual([
			{ name: "inline", content: `Hello ${FINAL_POSIX}`, description: "Inline", arguments: [] },
			{
				name: "filed",
				file: "c/filed.md",
				description: "Do $target",
				argumentHint: "<x>",
				arguments: ["target", "mode"],
			},
		]);
		const nested = render({ "commands/top.md": "Top", "commands/front/comp.md": "Comp" }).inventory;
		expect(nested.commands.map((command) => command.name)).toEqual(["front:comp", "top"]);
	});

	it("lets a skill win over a command of the same name", () => {
		const { inventory } = render({
			"skills/dup/SKILL.md": "---\ndescription: skill\n---\n",
			"commands/dup.md": "command",
		});
		expect(inventory.commands).toEqual([]);
		expect(inventory.skills.map((skill) => skill.name)).toEqual(["p:dup".replace("p", inventory.namespace)]);
		expect(inventory.warnings.join("\n")).toMatch(/command "dup".*skill/);
	});

	it("marks skills that are not user-invocable", () => {
		const { inventory } = render({
			"skills/hidden/SKILL.md": "---\ndescription: d\nuser-invocable: false\n---\n",
		});
		expect(inventory.skills[0]?.userInvocable).toBe(false);
	});

	it("warns about execution frontmatter, shell preprocessing and session tokens without running anything", () => {
		const { inventory, read } = render({
			"skills/x/SKILL.md":
				"---\ndescription: d\nallowed-tools: Bash\nmodel: opus\n---\nNow !`date` for ${CLAUDE_SESSION_ID} and ${user_config.token}\n",
		});
		const warnings = inventory.warnings.join("\n");
		expect(warnings).toMatch(/allowed-tools/);
		expect(warnings).toMatch(/model/);
		expect(warnings).toMatch(/!`cmd`/);
		expect(warnings).toMatch(/CLAUDE_SESSION_ID/);
		expect(warnings).toMatch(/user_config/);
		expect(read("skills/x/SKILL.md")).toContain("!`date` for ${CLAUDE_SESSION_ID} and ${user_config.token}");
	});

	it("rewrites Claude-form MCP tool names of the plugin's own servers, hyphens included", () => {
		const { read } = render({
			"plugin.json": { name: "my-tools", mcpServers: { "doc-search": { command: "x" } } },
			"skills/s/SKILL.md": "---\ndescription: d\n---\nCall mcp__plugin_my-tools_doc-search__find and mcp__other__x\n",
		});
		expect(pluginServerName("my-tools", "doc-search")).toBe("plugin_my-tools_doc-search");
		expect(parseFrontmatter(read("skills/s/SKILL.md")).body).toBe(
			"Call mcp__plugin_my_tools_doc_search__find and mcp__other__x",
		);
	});

	it("turns whitespace in command names into hyphens, since command names cannot contain it", () => {
		const { inventory } = render({
			"plugin.json": { name: "p", commands: ["./commands", "./inline-holder.md"] },
			"commands/my cmd.md": "spaced",
			"inline-holder.md": "x",
		});
		expect(inventory.commands.map((command) => command.name)).toEqual(["my-cmd", "inline-holder"]);
		const inline = render({ "plugin.json": { name: "p", commands: { "two words": { content: "hi" } } } });
		expect(inline.inventory.commands.map((command) => command.name)).toEqual(["two-words"]);
	});

	it("skips a skill or command with malformed frontmatter and renders the rest", () => {
		const { inventory } = render({
			"skills/bad/SKILL.md": "---\ndescription: [unclosed\n---\nbody\n",
			"skills/good/SKILL.md": "---\ndescription: fine\n---\nbody\n",
			"commands/broken.md": "---\nargs: {\n---\nbody\n",
			"commands/ok.md": "ok",
		});
		expect(inventory.skills.map((skill) => skill.file)).toEqual(["skills/good/SKILL.md"]);
		expect(inventory.commands.map((command) => command.name)).toEqual(["ok"]);
		expect(inventory.warnings.join("\n")).toMatch(/skills\/bad\/SKILL\.md/);
		expect(inventory.warnings.join("\n")).toMatch(/commands\/broken\.md/);
	});

	it("names plugin servers safely for tool names", () => {
		expect(pluginServerName("p", "a.b c")).toBe("plugin_p_a_b_c");
		expect(pluginServerName("p", "__x__")).toBe("plugin_p_x_");
	});
});
