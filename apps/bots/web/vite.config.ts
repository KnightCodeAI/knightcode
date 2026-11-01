// The KnightCode Bots web app. It builds to web/dist, which the Worker serves as static assets.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));

/** Local captures used to compare screens; outside the repository and optional. */
export const REFERENCE_DIR = process.env.BOTS_REFERENCE_DIR ?? resolve(here, "../../../../kc-bots-reference");

/** Serves the reference seed to the fake backend at /__seed/reference.json, in development only. */
function referenceSeed(): Plugin {
	return {
		name: "knightcode-bots-reference-seed",
		apply: "serve",
		configureServer(server) {
			server.middlewares.use("/__seed/reference.json", (_request, response) => {
				const file = resolve(REFERENCE_DIR, "seed.json");
				if (!existsSync(file)) {
					response.statusCode = 404;
					response.end();
					return;
				}
				response.setHeader("content-type", "application/json");
				response.end(readFileSync(file));
			});
		},
	};
}

export default defineConfig({
	root: here,
	plugins: [react(), referenceSeed()],
	build: { outDir: "dist", emptyOutDir: true },
	server: { port: 5190, strictPort: true },
});
