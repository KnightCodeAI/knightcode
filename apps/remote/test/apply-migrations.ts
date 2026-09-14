import { applyD1Migrations, env } from "cloudflare:test";

// vitest-pool-workers hands every test file an empty D1. Without this the suite fails
// with "no such table: accounts" rather than anything to do with the code under test.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
