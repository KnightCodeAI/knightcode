/** Shared wire schemas: both revisions of a package must agree on this immutable contract. */
import { Type } from "typebox";
export const read = { id: "read", params: Type.Null(), result: Type.Number() };
export const increment = { id: "increment", params: Type.Number(), result: Type.Number() };
export const tick = { id: "tick", schema: Type.Number() };
