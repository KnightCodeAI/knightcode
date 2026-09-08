import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { remoteCommands } from "../src/extension.ts";

describe("remote commands", () => {
	test("offers every dispatchable command except remote itself", () => {
		const offered = remoteCommands([
			{ name: "remote", description: "Publish this session" },
			{ name: "review", description: "Review the diff" },
			{ name: "skill:deploy" },
		]);
		expect(offered).toEqual([{ name: "review", description: "Review the diff" }, { name: "skill:deploy" }]);
	});

	test("a remote prompt takes the same expansion path as terminal input", () => {
		// Without expandPromptTemplates a "/review" typed on the phone would reach the model as
		// literal text. The option is what makes the command list in the browser mean anything.
		const source = readFileSync(join(import.meta.dirname, "..", "src", "extension.ts"), "utf8");
		expect(source).toMatch(/sendUserMessage\(text, \{ deliverAs: "followUp", expandPromptTemplates: true \}\)/);
	});
});
