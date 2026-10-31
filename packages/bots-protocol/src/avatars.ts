// The avatar shapes a bot can wear, shared by recipes, the UI renderer and the Worker.
import { type Static, Type } from "typebox";

/** The 25 named avatar shapes, in display order. */
export const AVATAR_SHAPES = [
	"blob",
	"pebble",
	"bean",
	"egg",
	"squircle",
	"tablet",
	"capsule",
	"cylinder",
	"hex",
	"gem",
	"crystal",
	"wedge",
	"shield",
	"dome",
	"arch",
	"cloud",
	"teardrop",
	"leaf",
	"square",
	"sparkle",
	"clover",
	"flower",
	"heart",
	"house",
	"star",
] as const;

export type AvatarShape = (typeof AVATAR_SHAPES)[number];

/** One of the named avatar shapes. */
export const AvatarShapeSchema = Type.Enum(AVATAR_SHAPES);

/** A bot's avatar: a named shape filled with a CSS colour. */
export const AvatarSchema = Type.Object({ shape: AvatarShapeSchema, color: Type.String({ minLength: 1 }) });
export type Avatar = Static<typeof AvatarSchema>;
