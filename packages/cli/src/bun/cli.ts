#!/usr/bin/env node
import { restoreSandboxEnv } from "./restore-sandbox-env.ts";

restoreSandboxEnv();

await import("./runtime-setup.ts");
await import("../cli.ts");
