import { afterEach, describe, expect, it } from "vitest";
import { cleanupServers, startServer } from "./harness.ts";
afterEach(cleanupServers);
describe("desktop customization skill discovery", () => {
	it("lists the shipped skill only after a desktop client binds the session", async () => {
		const server = await startServer();
		for (const mode of ["desktop", "tui"] as const) {
			const { client } = await server.connect(mode);
			const { thread } = await client.request("thread/start", { cwd: server.cwd });
			const loaded = await server.threads.ensureLoaded(thread.id, mode);
			const skills = loaded.session.resourceLoader.getSkills().skills;
			expect(skills.some((skill) => skill.name === "desktop-customization")).toBe(mode === "desktop");
			if (mode === "desktop") {
				expect(loaded.session.systemPrompt).toContain("desktop-customization");
				expect(loaded.session.systemPrompt).not.toContain("Trust development reloads");
			}
			client.close();
		}
	});
});
