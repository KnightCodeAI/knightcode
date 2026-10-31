// The notes plugin's server facet: serves `Index` with the same label.

import { constant, defineFacet } from "@knightcode/chord/next";
import { Index } from "@example/contracts/contract";
import { label } from "./label.ts";

export default defineFacet((host) => host.serve(Index, () => ({ label: constant(label) })));
