// The portable bot recipe (spec section 5): the JSON other bot apps read and write, at most 25 MB.
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import { ProtocolError, parse } from "./validate.ts";

export const RecipeSchema = Type.Object({
	profile: Type.Object({
		name: Type.String(),
		/** The bot's instructions. */
		description: Type.String(),
		avatarColor: Type.Optional(Type.String()),
		avatarShape: Type.Optional(Type.String()),
	}),
	memory: Type.Array(
		Type.Object({
			kind: Type.Optional(Type.Union([Type.Literal("profile"), Type.Literal("log")])),
			createdAt: Type.Optional(Type.String()),
			content: Type.String(),
		}),
	),
	skills: Type.Array(Type.Object({ name: Type.String(), description: Type.String(), content: Type.String() })),
	/** `content` is the prompt; recipes carry no triggers. */
	routines: Type.Array(
		Type.Object({ name: Type.String(), slug: Type.String(), description: Type.String(), content: Type.String() }),
	),
	plugins: Type.Array(
		Type.Object({ name: Type.String(), description: Type.Optional(Type.String()), pluginId: Type.String() }),
	),
	gettingStarted: Type.Optional(Type.Object({ skill: Type.String() })),
});
export type Recipe = Static<typeof RecipeSchema>;

export const RECIPE_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Parses a recipe from pasted or file text, or an already parsed value. Unknown fields are dropped
 * and kept nowhere; `gettingStarted.skill` must name one of `skills`.
 */
export function parseRecipe(json: unknown): Recipe {
	const text = typeof json === "string" ? json : JSON.stringify(json);
	if (new TextEncoder().encode(text).byteLength > RECIPE_MAX_BYTES)
		throw new ProtocolError("", "recipe is larger than 25 MB");
	const value: unknown = typeof json === "string" ? parseJson(json) : json;
	const recipe = parse(RecipeSchema, Value.Clean(RecipeSchema, Value.Clone(value)));
	const start = recipe.gettingStarted?.skill;
	if (start !== undefined && !recipe.skills.some((skill) => skill.name === start))
		throw new ProtocolError(
			"/gettingStarted/skill",
			`gettingStarted names "${start}", which is not one of the recipe's skills`,
		);
	return recipe;
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		throw new ProtocolError("", "recipe is not valid JSON");
	}
}
