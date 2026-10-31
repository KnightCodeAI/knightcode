import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env.ts";

// Empty shells; Parts 2 and 3 fill them in.
export class BotObject extends DurableObject<Env> {}
export class UserObject extends DurableObject<Env> {}
export class ComputerObject extends DurableObject<Env> {}

export default {
	async fetch(request, env): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (pathname === "/health") return Response.json({ ok: true });
		if (pathname === "/api" || pathname.startsWith("/api/")) return Response.json({ error: "not_found" }, { status: 404 });
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
