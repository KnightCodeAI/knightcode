/** Native extension artifact metadata and diagnostics; no renderer, agent or AI dependencies. */
import { type Static, type TSchema, Type } from "typebox";
/** Controlled ESM import placeholder; only a native serving lease may replace it. */
export const DESKTOP_ACTIVATION_MARKER = "__KNIGHTCODE_DESKTOP_ACTIVATION__";

const Str = Type.String({ maxLength: 4096 });
const Obj = Type.Object;
const strict = { additionalProperties: false } as const;
export const DesktopEntryKinds = Type.Array(Type.Union([Type.Literal("frontend"), Type.Literal("backend")]), {
	minItems: 1,
	maxItems: 2,
	uniqueItems: true,
});
export const DesktopArtifact = Obj(
	{
		owner: Str,
		kinds: Type.Optional(DesktopEntryKinds),
		revision: Str,
		root: Str,
		frontend: Str,
		backend: Type.Optional(Str),
		styles: Type.Array(Str),
		files: Type.Array(Str),
	},
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
		kinds: Type.Optional(DesktopEntryKinds),
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
export const DesktopActivationBinding = Obj({ owner: Str, revision: Str, epoch: Str, window: Str, mount: Str }, strict);
export type DesktopActivationBinding = Static<typeof DesktopActivationBinding>;
const WindowIdentity = { windowId: Type.Integer({ minimum: 0 }), lifetime: Str };
const Sequence = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const Schema = Type.Unsafe<TSchema>({ type: "object" });
export const DesktopBackendContracts = Obj(
	{
		methods: Type.Record(
			Type.String(),
			Obj({ kind: Type.Union([Type.Literal("read"), Type.Literal("write")]), params: Schema, result: Schema }, strict),
		),
		events: Type.Record(Type.String(), Schema),
	},
	strict,
);
export type DesktopBackendContracts = Static<typeof DesktopBackendContracts>;
export const DesktopCallResult = Type.Union([
	Obj({ status: Type.Literal("ok"), value: Type.Unknown() }, strict),
	Obj({ status: Type.Literal("error"), message: Str }, strict),
	Obj({ status: Type.Literal("disconnected") }, strict),
	Obj({ status: Type.Literal("cancelled") }, strict),
	Obj({ status: Type.Literal("outcome-unknown") }, strict),
]);
export const DesktopExtensionPhase = Obj(
	{
		...WindowIdentity,
		id: Str,
		binding: DesktopActivationBinding,
		phase: Type.Union([
			Type.Literal("prepare"),
			Type.Literal("quiesce"),
			Type.Literal("publish"),
			Type.Literal("resume"),
			Type.Literal("discard"),
			Type.Literal("revoke"),
			Type.Literal("ready"),
		]),
		artifact: Type.Optional(DesktopArtifact),
		contracts: Type.Optional(DesktopBackendContracts),
	},
	strict,
);
export type DesktopExtensionPhase = Static<typeof DesktopExtensionPhase>;
export const DesktopExtensionEvent = Obj(
	{ ...WindowIdentity, binding: DesktopActivationBinding, id: Str, event: Str, value: Type.Unknown() },
	strict,
);
export type DesktopExtensionEvent = Static<typeof DesktopExtensionEvent>;
export const DesktopRuntimeRequests = {
	"desktopExtension/window/connect": { params: Obj(WindowIdentity, strict), result: Obj({}, strict) },
	"desktopExtension/window/disconnect": { params: Obj(WindowIdentity, strict), result: Obj({}, strict) },
	"desktopExtension/reconcile": {
		params: Obj({ ...WindowIdentity, cwd: Type.Optional(Str) }, strict),
		result: Obj({}, strict),
	},
	"desktopExtension/ack": {
		params: Obj({ ...WindowIdentity, id: Str, binding: DesktopActivationBinding, error: Type.Optional(Str) }, strict),
		result: Obj({}, strict),
	},
	"desktopExtension/fail": {
		params: Obj({ ...WindowIdentity, binding: DesktopActivationBinding, message: Str }, strict),
		result: Obj({}, strict),
	},
	"desktopExtension/call": {
		params: Obj(
			{ ...WindowIdentity, binding: DesktopActivationBinding, requestId: Sequence, method: Str, args: Type.Unknown() },
			strict,
		),
		result: DesktopCallResult,
	},
	"desktopExtension/cancel": {
		params: Obj({ ...WindowIdentity, binding: DesktopActivationBinding, requestId: Sequence }, strict),
		result: Obj({}, strict),
	},
	"desktopExtension/subscribe": {
		params: Obj({ ...WindowIdentity, binding: DesktopActivationBinding, id: Str, event: Str }, strict),
		result: Obj({ status: Type.Union([Type.Literal("subscribed"), Type.Literal("disconnected")]) }, strict),
	},
	"desktopExtension/unsubscribe": {
		params: Obj({ ...WindowIdentity, binding: DesktopActivationBinding, id: Str }, strict),
		result: Obj({}, strict),
	},
} as const;
export const DesktopExtensionRequests = {
	...DesktopRuntimeRequests,
	"desktopExtension/list": {
		params: Obj({ cwd: Type.Optional(Str) }, strict),
		result: Obj(
			{ safeMode: Type.Boolean(), preview: Type.Boolean(), extensions: Type.Array(DesktopExtensionInfo) },
			strict,
		),
	},
	/** The "Native desktop extensions (preview)" switch; off means no external frontend or backend code runs. */
	"desktopExtension/preview/set": { params: Obj({ enabled: Type.Boolean() }, strict), result: Obj({}, strict) },
	"desktopExtension/set": {
		params: Obj(
			{
				owner: Str,
				cwd: Type.Optional(Str),
				enabled: Type.Optional(Type.Boolean()),
				approve: Type.Optional(Type.Boolean()),
				kinds: Type.Optional(DesktopEntryKinds),
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
	"desktopExtension/phase": DesktopExtensionPhase,
	"desktopExtension/event": DesktopExtensionEvent,
	"desktopExtension/changed": Obj({ reload: Type.Optional(Type.Boolean()) }, strict),
} as const;
