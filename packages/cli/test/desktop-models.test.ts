import { expect, test } from "vitest";
import { declarationOf } from "../scripts/desktop-models.ts";

test("portable desktop read models preserve required, optional, union and record values", () => {
	expect(
		declarationOf({
			type: "object",
			properties: { id: { type: "string" }, value: { anyOf: [{ const: "idle" }, { type: "number" }] } },
			required: ["id"],
			additionalProperties: false,
		}),
	).toBe('{ "id": string; "value"?: ("idle" | number) }');
	expect(
		declarationOf({ type: "object", patternProperties: { "^.*$": { type: "array", items: { type: "boolean" } } } }),
	).toBe("Record<string, (boolean)[]>");
	expect(() => declarationOf({ $ref: "unknown" })).toThrow("Unsupported desktop read-model schema");
});
