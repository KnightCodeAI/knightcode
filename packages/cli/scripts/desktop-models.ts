/** Emit portable desktop read-model types from the existing validated domain schemas. */
import {
	ClientRequests,
	ApprovalMode,
	ThinkingLevel,
	ToolOutput,
	Item,
	Turn,
	Thread,
	TurnFile,
	TurnQueue,
	UiSnapshot,
	BackgroundShell,
	BackgroundShellNotice,
	ImageInput,
	ApprovalResult,
	ServerRequests,
	View,
} from "@knightcode/app-server-protocol";

interface Schema {
	"~kind"?: string;
	additionalProperties?: boolean | Schema;
	type?: string;
	const?: unknown;
	anyOf?: Schema[];
	allOf?: Schema[];
	properties?: Record<string, Schema>;
	required?: string[];
	items?: Schema;
	patternProperties?: Record<string, Schema>;
	$defs?: Record<string, Schema>;
	$ref?: string;
}

/** Preserve domain data shapes without exporting protocol clients or workspace-only type imports. */
export function declarationOf(schema: Schema): string {
	if (schema.$defs && schema.$ref) {
		const name = schema.$ref.split("/").at(-1)!;
		const definition = schema.$defs[name];
		if (!definition) throw new Error("Unsupported desktop read-model schema reference");
		return declarationOf(definition);
	}
	if (schema.$ref) {
		if (schema.$ref === "#/$defs/View" || schema.$ref === "View") return "View";
		throw new Error("Unsupported desktop read-model schema reference");
	}
	if (Object.hasOwn(schema, "const")) return JSON.stringify(schema.const);
	if (schema.anyOf) return `(${schema.anyOf.map(declarationOf).join(" | ")})`;
	if (schema.allOf) return `(${schema.allOf.map(declarationOf).join(" & ")})`;
	switch (schema.type) {
		case "string":
		case "number":
		case "boolean":
		case "null":
			return schema.type;
		case "integer":
			return "number";
		case "array":
			return `(${declarationOf(schema.items ?? {})})[]`;
		case "object": {
			if (schema.patternProperties)
				return `Record<string, ${declarationOf(Object.values(schema.patternProperties)[0] ?? {})}>`;
			const fields = Object.entries(schema.properties ?? {}).map(
				([name, value]) =>
					`${JSON.stringify(name)}${schema.required?.includes(name) ? "" : "?"}: ${declarationOf(value)}`,
			);
			return `{ ${fields.join("; ")} }`;
		}
		case undefined:
			return "unknown";
		default:
			throw new Error(`Unsupported desktop read-model schema type ${schema.type}`);
	}
}

/** Generate self-contained types for renderer reads and mediated request replies. */
export function generateDesktopModels(): string {
	const schemas = {
		View,
		ApprovalMode,
		ThinkingLevel,
		ModelInfo: ClientRequests["model/list"].result.properties.models.items,
		ToolOutput,
		Item,
		Turn,
		Thread,
		TurnFile,
		TurnQueue,
		UiSnapshot,
		BackgroundShell,
		BackgroundShellNotice,
		ImageInput,
		ApprovalResult,
		ApprovalParams: ServerRequests["item/toolCall/requestApproval"].params,
		DialogParams: ServerRequests["ui/dialog"].params,
		DialogResult: ServerRequests["ui/dialog"].result,
		QuestionParams: ServerRequests["item/toolCall/requestUserInput"].params,
		QuestionResult: ServerRequests["item/toolCall/requestUserInput"].result,
	};
	return (
		"// Generated from app-server-protocol domain schemas. Run generate-desktop-api.ts.\n" +
		Object.entries(schemas)
			.map(([name, schema]) => `export type ${name} = ${declarationOf(schema)};`)
			.join("\n") +
		"\n"
	);
}
