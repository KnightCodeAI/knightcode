import { expect, test, vi } from "vitest";
import { squirrelMessage } from "../../src/main/updates.ts";

vi.mock("electron", () => ({ app: {}, autoUpdater: {}, net: {} }));

test("a Squirrel failure reads as its innermost message, not Update.exe's stack", () => {
	// What an installed build got from a feed that answered 404 (2026-10-23), shortened.
	const failure =
		"Command failed: 4294967295 System.AggregateException: One or more errors occurred. ---> " +
		"System.Net.WebException: The remote server returned an error: (404) Not Found. " +
		"at System.Net.HttpWebRequest.EndGetResponse(IAsyncResult asyncResult) " +
		"at System.Net.WebClient.GetWebResponse(WebRequest request, IAsyncResult result)";
	expect(squirrelMessage(failure)).toBe("The remote server returned an error: (404) Not Found.");
	expect(squirrelMessage("Can not find Squirrel")).toBe("Can not find Squirrel");
});
