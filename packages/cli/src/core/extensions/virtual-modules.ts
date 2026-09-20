import * as bundledKnightAgent from "@knightcode/agent";
import * as bundledKnightAiCompat from "@knightcode/ai/compat";
import * as bundledKnightAiOauth from "@knightcode/ai/oauth";
import * as bundledKnightAiProviders from "@knightcode/ai/providers/all";
import * as bundledKnightTui from "@knightcode/tui";
import * as bundledTypebox from "typebox";
import * as bundledTypeboxCompile from "typebox/compile";
import * as bundledTypeboxValue from "typebox/value";
// This import is safe because loader.ts exports are not re-exported from index.ts.
// Extensions can therefore import from @knightcodeai/cli.
import * as bundledKnightCli from "../../index.ts";

/** Modules available to extensions in source and compiled binary runtimes. */
export const VIRTUAL_MODULES: Record<string, unknown> = {
	typebox: bundledTypebox,
	"typebox/compile": bundledTypeboxCompile,
	"typebox/value": bundledTypeboxValue,
	"@sinclair/typebox": bundledTypebox,
	"@sinclair/typebox/compile": bundledTypeboxCompile,
	"@sinclair/typebox/value": bundledTypeboxValue,
	"@knightcode/agent": bundledKnightAgent,
	"@knightcode/tui": bundledKnightTui,
	// Extensions resolve the @knightcode/ai root to the compat entrypoint (a
	// strict superset of the core entrypoint).
	"@knightcode/ai": bundledKnightAiCompat,
	"@knightcode/ai/compat": bundledKnightAiCompat,
	"@knightcode/ai/oauth": bundledKnightAiOauth,
	"@knightcode/ai/providers/all": bundledKnightAiProviders,
	"@knightcodeai/cli": bundledKnightCli,
};
