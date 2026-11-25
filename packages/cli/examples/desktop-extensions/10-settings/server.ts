/** Settings the frontend section declares; the secret one never reaches the renderer. */
import { experimental_defineDesktopBackend } from "@knightcodeai/cli/desktop-backend";
import { Type } from "typebox";

export default experimental_defineDesktopBackend((app) => {
	app.experimental_setting({ id: "greeting", schema: Type.Boolean(), default: true });
	app.experimental_setting({
		id: "density",
		schema: Type.Union([Type.Literal("comfortable"), Type.Literal("compact")]),
		default: "comfortable",
	});
	app.experimental_setting({ id: "limit", schema: Type.Number(), default: 20 });
	app.experimental_setting({ id: "token", schema: Type.String(), default: "server-only", secret: true });
});
