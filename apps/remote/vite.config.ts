import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The app lives in web/ and builds to web/dist, which is what wrangler.jsonc serves as the
// ASSETS binding. vitest.config.ts is a separate file on purpose: vitest picks that one up,
// so the Worker test pool never loads this browser build config.
export default defineConfig({
	root: "web",
	plugins: [react()],
	resolve: {
		// Matches web/tsconfig.json paths; shadcn generates imports against "@/".
		alias: { "@": fileURLToPath(new URL("./web/src", import.meta.url)) },
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
	server: {
		port: 5183,
		// `bun run dev` serves the app; everything with a server behind it goes to
		// `bun run dev:worker` (wrangler on 8787), so there is no mock relay to drift.
		proxy: {
			"/api": "http://localhost:8787",
			"/login": "http://localhost:8787",
			"/logout": "http://localhost:8787",
			"/auth": "http://localhost:8787",
			// Only the socket. Proxying the whole /r/<id> page handed the Worker's built shell
			// to the dev server, whose asset urls exist only in web/dist, so rooms never opened.
			"^/r/[0-9A-F]{32}/ws$": { target: "ws://localhost:8787", ws: true },
		},
	},
});
