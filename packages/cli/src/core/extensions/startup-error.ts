/** A configuration refusal that makes the extension runtime unsafe to use. */
export class ExtensionStartupError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ExtensionStartupError";
	}
}
