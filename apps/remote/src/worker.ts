// Placeholder router; replaced with the real one in Task 9. The Vitest workers pool
// resolves wrangler's `main` for every test file, and the RemoteRoom re-export is what
// the durable_objects binding resolves against.
export { RemoteRoom } from "./room.ts";

export default {
	async fetch(): Promise<Response> {
		return new Response("Not found", { status: 404 });
	},
};
