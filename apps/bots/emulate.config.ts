// The third-party services the Worker talks to, emulated locally (Vercel Labs' emulate) for tests and `npx emulate`.
// Each service is seeded with one user and KnightCode Bots' OAuth app registered for the production callback URL,
// which the Worker under test also uses (its requests go to https://bots.knightcode.dev).
import { defineConfig } from "emulate";

export const TEST_OAUTH = {
	github: { clientId: "kb-test-github", clientSecret: "kb-test-github-secret" },
	google: { clientId: "kb-test-google.apps.googleusercontent.com", clientSecret: "kb-test-google-secret" },
} as const;

export default defineConfig({
	services: {
		github: {
			emulator: "github",
			seed: {
				users: [{ login: "ada-test", name: "Ada Test", email: "ada@example.com" }],
				oauth_apps: [
					{
						client_id: TEST_OAUTH.github.clientId,
						client_secret: TEST_OAUTH.github.clientSecret,
						name: "KnightCode Bots",
						redirect_uris: ["https://bots.knightcode.dev/auth/github/callback"],
					},
				],
			},
		},
		google: {
			emulator: "google",
			seed: {
				users: [{ email: "grace@example.com", name: "Grace Test" }],
				oauth_clients: [
					{
						client_id: TEST_OAUTH.google.clientId,
						client_secret: TEST_OAUTH.google.clientSecret,
						redirect_uris: ["https://bots.knightcode.dev/auth/google/callback"],
					},
				],
			},
		},
	},
});
