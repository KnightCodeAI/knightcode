import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import type { Env as WorkerEnv } from "../src/accounts.ts";

// `cloudflare:test` types `env` as `Cloudflare.Env`, the namespace `wrangler types`
// generates. This repo declares it by hand from the Env the Worker already uses, plus
// the migration list vitest.config.ts injects as a binding.
declare global {
	namespace Cloudflare {
		interface Env extends WorkerEnv {
			TEST_MIGRATIONS: D1Migration[];
		}
	}
}
