import { refreshGeminiWebCookies } from "../api/gemini-web-cookies.ts";
import { geminiWebApi } from "../api/gemini-web.lazy.ts";
import { parseGeminiWebCookies } from "../api/gemini-web-protocol.ts";
import { GeminiWebSessionWaitError, initGeminiWebSession } from "../api/gemini-web-session.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import type { ApiKeyAuth } from "../auth/types.ts";
import { createProvider, type Provider } from "../models.ts";
import { GEMINI_WEB_MODELS } from "./gemini-web.models.ts";

const GEMINI_WEB_BASE_URL = "https://gemini.google.com";

const LOGIN_WARNING =
	"Experimental. This signs in with your Google session cookies, which grant access to your whole Google account, not just Gemini. " +
	"They are stored in plaintext in auth.json: run /logout before uninstalling and never share that file. " +
	"Using the Gemini web app this way is not supported by Google and may violate its terms; the account can be restricted. " +
	"Cookies expire, and you will need to log in again.";

const baseAuth = envApiKeyAuth("Gemini web cookies", ["GEMINI_WEB_COOKIES"]);

const geminiWebAuth: ApiKeyAuth = {
	...baseAuth,
	name: "Gemini web session cookies",
	isSubscription: true,
	login: async (interaction) => {
		interaction.signal.throwIfAborted();
		interaction.notify({ type: "info", message: LOGIN_WARNING });
		const psid = await interaction.prompt({
			type: "secret",
			message: "Enter the __Secure-1PSID cookie value from gemini.google.com",
		});
		interaction.signal.throwIfAborted();
		const psidts = await interaction.prompt({
			type: "secret",
			message: "Enter the __Secure-1PSIDTS cookie value (leave empty if the browser shows none)",
		});
		interaction.signal.throwIfAborted();

		const pasted = parseGeminiWebCookies(
			`__Secure-1PSID=${psid.trim()}${psidts.trim() ? `; __Secure-1PSIDTS=${psidts.trim()}` : ""}`,
		);
		interaction.notify({ type: "progress", message: "Checking the session with Gemini web..." });
		const rotated = await refreshGeminiWebCookies({
			cookie: pasted,
			fetch: globalThis.fetch,
			signal: interaction.signal,
		});
		const loaded = await initGeminiWebSession({
			cookie: rotated,
			fetch: globalThis.fetch,
			headers: {},
			signal: interaction.signal,
		}).catch(async (error: unknown) => {
			if (interaction.signal.aborted || error instanceof GeminiWebSessionWaitError || rotated === pasted) throw error;
			return initGeminiWebSession({
				cookie: pasted,
				fetch: globalThis.fetch,
				headers: {},
				signal: interaction.signal,
			});
		});
		return { type: "api_key", key: loaded.cookie };
	},
};

/** Experimental Gemini web app provider; see `api/gemini-web.ts` for what it can and cannot do. */
export function geminiWebProvider(): Provider<"gemini-web"> {
	return createProvider({
		id: "gemini-web",
		name: "Gemini web",
		baseUrl: GEMINI_WEB_BASE_URL,
		auth: { apiKey: geminiWebAuth },
		models: Object.values(GEMINI_WEB_MODELS),
		api: geminiWebApi(),
	});
}
