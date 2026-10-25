import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	root: "src/renderer",
	// Forge's outDir (.vite/renderer/main_window) is relative, so the root above would move it under src/renderer and
	// out of the package; main loads the renderer from beside .vite/build.
	// Outside the root Vite would not empty it (Forge also deletes .vite before a production build).
	build: { outDir: fileURLToPath(new URL(".vite/renderer/main_window", import.meta.url)), emptyOutDir: true },
	plugins: [react()],
	css: { postcss: { plugins: [tailwindcss()] } },
});
