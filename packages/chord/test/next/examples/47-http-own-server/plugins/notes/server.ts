// The notes plugin's server facet: one route, the same whichever server runs it.

import { defineFacet } from "@knightcode/chord/next";
import { Http } from "@knightcode/chord/next/http";

export default defineFacet((_host, self) =>
	self.contribute(Http, {
		routes: {
			"GET /notes": async (request) => ({ kind: "json", value: { notes: ["buy milk"], via: request.origin } }),
		},
	}),
);
