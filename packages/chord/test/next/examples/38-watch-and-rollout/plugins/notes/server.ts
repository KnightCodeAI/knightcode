// The notes plugin's server facet: its label.

import { constant, defineFacet } from "@knightcode/chord/next";
import { labelOf } from "@example/shared/contract";
import { label } from "./label.ts";

export default defineFacet((host) =>
	host.serve(labelOf("notes"), () => ({ text: constant(`${label} on the server`) })),
);
