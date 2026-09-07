// Placeholder entry point; replaced with the real router in Task 9. The Vitest
// workers pool resolves wrangler's `main` for every test file, so this must exist.
export default {
	async fetch(): Promise<Response> {
		return new Response("Not found", { status: 404 });
	},
};
