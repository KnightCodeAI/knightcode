/** Validated host operations for native frontend artifacts, not a public extension bridge. */
import { DesktopExtensionDiagnostic, DesktopExtensionRequests } from "@knightcode/app-server-protocol";
import { type Static, Type } from "typebox";
export const DesktopProviderPreferences = Type.Object(
	{ app: Type.Record(Type.String(), Type.String()), window: Type.Record(Type.String(), Type.String()) },
	{ additionalProperties: false },
);
export type DesktopProviderPreferences = Static<typeof DesktopProviderPreferences>;
export const DesktopExtensionHostMethods = {
	"host/desktopExtension/list": {
		params: Type.Object(
			{
				cwd: Type.Optional(Type.String()),
				runtime: Type.Optional(Type.Record(Type.String(), Type.Array(Type.String()))),
			},
			{ additionalProperties: false },
		),
		result: Type.Object(
			{ ...DesktopExtensionRequests["desktopExtension/list"].result.properties, providers: DesktopProviderPreferences },
			{ additionalProperties: false },
		),
	},
	"host/desktopExtension/provider/set": {
		params: Type.Object(
			{
				surface: Type.Union([
					Type.Literal("feedback"),
					Type.Literal("layout"),
					Type.Literal("navigation"),
					Type.Literal("threadList"),
					Type.Literal("home"),
					Type.Literal("titleBar"),
				]),
				scope: Type.Union([Type.Literal("app"), Type.Literal("window")]),
				provider: Type.String({ maxLength: 256 }),
			},
			{ additionalProperties: false },
		),
		result: Type.Object({}, { additionalProperties: false }),
	},
	"host/desktopExtension/acquire": {
		params: Type.Object(
			{ owner: Type.String(), revision: Type.String(), lease: Type.String({ minLength: 1, maxLength: 128 }) },
			{ additionalProperties: false },
		),
		result: Type.Object({}, { additionalProperties: false }),
	},
	"host/desktopExtension/set": DesktopExtensionRequests["desktopExtension/set"],
	"host/desktopExtension/reload": DesktopExtensionRequests["desktopExtension/reload"],
	"host/desktopExtension/diagnostic": {
		params: Type.Object(
			{ owner: Type.String(), diagnostic: Type.Omit(DesktopExtensionDiagnostic, ["windowId"]) },
			{ additionalProperties: false },
		),
		result: Type.Object({}, { additionalProperties: false }),
	},
	"host/desktopExtension/release": {
		params: Type.Object(
			{ owner: Type.String(), revision: Type.String(), lease: Type.String({ minLength: 1, maxLength: 128 }) },
			{ additionalProperties: false },
		),
		result: Type.Object({}, { additionalProperties: false }),
	},
} as const;
