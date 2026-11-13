/** Frontend extension artifacts and diagnostics; no renderer, agent or AI dependencies. */
import { type Static, Type } from "typebox";
const Str = Type.String({ maxLength: 4096 });
const Obj = Type.Object;
const strict = { additionalProperties: false } as const;
export const DesktopArtifact = Obj(
	{ owner: Str, revision: Str, root: Str, frontend: Str, styles: Type.Array(Str), files: Type.Array(Str) },
	strict,
);
export const DesktopExtensionDiagnostic = Obj(
	{
		windowId: Type.Integer(),
		revision: Str,
		phase: Type.Union([Type.Literal("active"), Type.Literal("load"), Type.Literal("render"), Type.Literal("dispose")]),
		message: Str,
	},
	strict,
);
export type DesktopExtensionDiagnostic = Static<typeof DesktopExtensionDiagnostic>;
export const DesktopExtensionInfo = Obj(
	{
		owner: Str,
		name: Str,
		source: Str,
		scope: Type.Union([Type.Literal("user"), Type.Literal("project")]),
		approved: Type.Boolean(),
		enabled: Type.Boolean(),
		dev: Type.Boolean(),
		revision: Type.Optional(Str),
		error: Type.Optional(Str),
		artifact: Type.Optional(DesktopArtifact),
		diagnostics: Type.Array(DesktopExtensionDiagnostic),
	},
	strict,
);
export type DesktopExtensionInfo = Static<typeof DesktopExtensionInfo>;
export const DesktopExtensionRequests = {
	"desktopExtension/list": {
		params: Obj({ cwd: Type.Optional(Str) }, strict),
		result: Obj({ safeMode: Type.Boolean(), extensions: Type.Array(DesktopExtensionInfo) }, strict),
	},
	"desktopExtension/set": {
		params: Obj(
			{
				owner: Str,
				cwd: Type.Optional(Str),
				enabled: Type.Optional(Type.Boolean()),
				approve: Type.Optional(Type.Boolean()),
				revoke: Type.Optional(Type.Boolean()),
				dev: Type.Optional(Type.Boolean()),
				source: Type.Optional(Str),
			},
			strict,
		),
		result: Obj({}, strict),
	},
	"desktopExtension/reload": { params: Obj({}, strict), result: Obj({}, strict) },
	"desktopExtension/diagnostic": {
		params: Obj({ owner: Str, diagnostic: DesktopExtensionDiagnostic }, strict),
		result: Obj({}, strict),
	},
} as const;
export const DesktopExtensionNotifications = {
	"desktopExtension/changed": Obj({ reload: Type.Optional(Type.Boolean()) }, strict),
} as const;
