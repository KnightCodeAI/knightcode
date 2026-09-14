import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The browser app's pure modules (transcript grouping, markdown) run under plain node.
// The relay's own suite lives in ../vitest.config.ts on the Workers pool.
export default defineConfig({
	resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
	test: {
		root: fileURLToPath(new URL(".", import.meta.url)),
		include: ["test/**/*.test.{ts,tsx}"],
		environment: "node",
	},
});
