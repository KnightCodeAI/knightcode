#!/usr/bin/env bun
/**
 * knightcode-engine acp, runnable from source: the entry a stock Zed
 * `agent_servers` entry points at before the fork exists.
 */

// Static, and first, for the reason engine-entry.ts gives: the OAuth flows
// behind the shared credential store load through this in a compiled binary.
import "../../bun/runtime-setup.ts";
import { runAcp } from "./run.ts";

process.title = "knightcode-acp";
process.env.KNIGHTCODE_CODING_AGENT = "true";
process.env.AI_AGENT = "knightcode";

await runAcp(process.argv.slice(2));
process.exit(0);
