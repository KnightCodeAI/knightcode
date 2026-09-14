import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type ToolResultMessage } from "@knightcode/ai";
import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import {
	type AgentSession,
	createAgentSessionFromServices,
	createAgentSessionServices,
	ModelRuntime,
	SessionManager,
} from "@knightcodeai/cli";
import { afterEach, describe, expect, it } from "vitest";
import { createEvalSandboxGuard, describeEvalEscape, type EvalSandbox } from "../src/knightcode-harness.ts";

const sandbox: EvalSandbox = {
	root: resolve("/eval/run"),
	cwd: resolve("/eval/run/workspace"),
	home: resolve("/eval/run/home"),
	protectedPaths: ["C:\\Users\\me\\Desktop\\knightcode", "/home/me/.knightcode"],
};

describe("describeEvalEscape", () => {
	it.each([
		"notes.md",
		".knightcode/extensions/hello.ts",
		"~/.knightcode/agent/models.json",
		"@../home/.knightcode/agent/models.json",
	])("lets write and edit change %s inside the eval directory", (path) => {
		expect(describeEvalEscape({ toolName: "write", input: { path } }, sandbox)).toBeUndefined();
		expect(describeEvalEscape({ toolName: "edit", input: { path } }, sandbox)).toBeUndefined();
	});

	it.each([
		resolve("/src/knightcode/packages/ai/scripts/generate-models.ts"),
		"../../other/notes.md",
		resolve("/eval/run-other/notes.md"),
		"/tmp/add_model.js",
	])("blocks write and edit to %s", (path) => {
		expect(describeEvalEscape({ toolName: "write", input: { path } }, sandbox)).toContain(
			"Blocked by the eval sandbox",
		);
		expect(describeEvalEscape({ toolName: "edit", input: { path } }, sandbox)).toContain("Blocked by the eval sandbox");
	});

	it.each([
		["bash", "cd C:/Users/me/Desktop/knightcode/packages/ai && npm run generate-models"],
		["bash", "sed -i s/a/b/ /c/Users/me/Desktop/knightcode/package.json"],
		["powershell", "Get-Content C:\\Users\\ME\\Desktop\\knightcode\\README.md"],
		["bash", "cat /home/me/.knightcode/agent/auth.json"],
	])("blocks a %s command naming a protected path: %s", (toolName, command) => {
		expect(describeEvalEscape({ toolName, input: { command } }, sandbox)).toContain("Blocked by the eval sandbox");
	});

	it.each(["cat ~/.knightcode/agent/models.json", "ls -la", "node -e \"require('fs').writeFileSync('a.json', '{}')\""])(
		"lets a shell command run when it names no protected path: %s",
		(command) => {
			expect(describeEvalEscape({ toolName: "bash", input: { command } }, sandbox)).toBeUndefined();
		},
	);

	it("does not restrict reading", () => {
		expect(
			describeEvalEscape({ toolName: "read", input: { path: "C:/Users/me/Desktop/knightcode/README.md" } }, sandbox),
		).toBeUndefined();
	});
});

describe("createEvalSandboxGuard", () => {
	const dirs: string[] = [];
	let session: AgentSession | undefined;

	afterEach(() => {
		session?.dispose();
		session = undefined;
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it("blocks escaping tool calls in a real session and lets the rest run", async () => {
		const root = mkdtempSync(join(tmpdir(), "knightcode-eval-guard-"));
		const repository = mkdtempSync(join(tmpdir(), "knightcode-eval-guard-repo-"));
		dirs.push(root, repository);
		const cwd = join(root, "workspace");
		const agentDir = join(root, "home", ".knightcode", "agent");
		mkdirSync(cwd);
		mkdirSync(agentDir, { recursive: true });
		const modelRuntime = await ModelRuntime.create({
			credentials: new InMemoryCredentialStore(),
			modelsPath: null,
			allowModelNetwork: false,
		});
		const faux = fauxProvider({ provider: "faux-eval-sandbox" });
		modelRuntime.registerNativeProvider(faux.provider);
		const guard = createEvalSandboxGuard({ root, cwd, home: join(root, "home"), protectedPaths: [repository] });
		const services = await createAgentSessionServices({
			cwd,
			agentDir,
			modelRuntime,
			resourceLoaderOptions: { extensionFactories: [guard] },
		});
		session = (
			await createAgentSessionFromServices({
				services,
				sessionManager: SessionManager.inMemory(cwd),
				model: faux.getModel(),
			})
		).session;

		const repositoryFile = join(repository, "generate-models.ts");
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: repositoryFile, content: "edited" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage(
				[fauxToolCall("bash", { command: `echo edited > ${repositoryFile.replaceAll("\\", "/")}` })],
				{
					stopReason: "toolUse",
				},
			),
			fauxAssistantMessage([fauxToolCall("write", { path: "notes.md", content: "kept" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("done")]),
		]);
		await session.prompt("try to leave the sandbox");

		const results = session.messages.filter((message): message is ToolResultMessage => message.role === "toolResult");
		expect(results.map((result) => [result.toolName, result.isError])).toEqual([
			["write", true],
			["bash", true],
			["write", false],
		]);
		expect(JSON.stringify(results[0].content)).toContain("Blocked by the eval sandbox");
		expect(JSON.stringify(results[1].content)).toContain("Blocked by the eval sandbox");
		expect(existsSync(repositoryFile)).toBe(false);
		expect(existsSync(join(cwd, "notes.md"))).toBe(true);
	});
});
