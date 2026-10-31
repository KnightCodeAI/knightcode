// The notes plugin: a route, and its own wrap (around its own routes only) adding a header.

import { defineFacet } from "@knightcode/chord/next";
import { Http } from "@knightcode/chord/next/http";

export default defineFacet((_host, self) =>
	self.contribute(Http, {
		routes: { "GET /notes": async () => ({ kind: "json", value: ["buy milk", "call mom"] }) },
		wraps: [
			{
				name: "cache",
				phase: "headers",
				wrap: async (request, next) => {
					const response = await next(request);
					return { ...response, headers: { ...response.headers, "Cache-Control": "max-age=60" } };
				},
			},
		],
	}),
);
