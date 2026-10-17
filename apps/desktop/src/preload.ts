/**
 * Hands the page its one MessagePort and nothing else (desktop-shell.md section 4.1). The port goes
 * only to the expected origin; `window.knightcode` is a frozen pair of facts.
 *
 * The page asks with "kc:hello" once its listener exists, and gets the latest port then: posting at
 * DOMContentLoaded would race module loading and lose the port.
 */

import { contextBridge, ipcRenderer } from "electron";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--kc-${name}=`))?.slice(name.length + 6) ?? "";
const origin = arg("origin");
const windowId = Number(arg("window-id"));

contextBridge.exposeInMainWorld("knightcode", Object.freeze({ platform: process.platform, windowId }));

let port: MessagePort | undefined;
let wanted = false;

function deliver(): void {
	if (!port || !wanted || window.location.origin !== origin) return;
	window.postMessage("kc:port", origin, [port]);
	port = undefined;
}

ipcRenderer.on("kc:port", (event) => {
	port = event.ports[0];
	deliver();
});

window.addEventListener("message", (event) => {
	if (event.source !== window || event.origin !== origin || event.data !== "kc:hello") return;
	wanted = true;
	deliver();
});
