// The service worker: shows Web Push notifications (approvals, questions and replies) and opens the right chat when
// one is tapped. It caches nothing; the app always loads from the network.

// The few service worker types used here; the web app's lib is DOM, whose worker types would clash.
type Extendable = Event & { waitUntil(promise: Promise<unknown>): void };
type PushEvent = Extendable & { data: { json(): unknown } | null };
type ClickEvent = Extendable & { notification: Notification };
type WindowClient = { url: string; focus(): Promise<unknown>; navigate(url: string): Promise<unknown> };
type Scope = {
	registration: ServiceWorkerRegistration;
	location: Location;
	skipWaiting(): Promise<void>;
	clients: {
		claim(): Promise<void>;
		matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<WindowClient[]>;
		openWindow(url: string): Promise<unknown>;
	};
	addEventListener(type: "install" | "activate", listener: (event: Extendable) => void): void;
	addEventListener(type: "push", listener: (event: PushEvent) => void): void;
	addEventListener(type: "notificationclick", listener: (event: ClickEvent) => void): void;
};

/** What the server sends: a title, the preview the user allowed, and the path to open. */
type Payload = { title?: string; body?: string; path?: string; tag?: string };

const sw = self as unknown as Scope;

/** Only paths on this origin open; anything else opens the home screen. */
function target(path: unknown): string {
	try {
		const url = new URL(typeof path === "string" ? path : "/", sw.location.origin);
		return url.origin === sw.location.origin ? url.href : sw.location.origin;
	} catch {
		return sw.location.origin;
	}
}

sw.addEventListener("install", () => void sw.skipWaiting());
sw.addEventListener("activate", (event) => event.waitUntil(sw.clients.claim()));

sw.addEventListener("push", (event) => {
	let payload: Payload = {};
	try {
		const body: unknown = event.data?.json();
		// Only an object's string fields are used; anything else falls back to the defaults.
		if (body && typeof body === "object") {
			const fields = body as Record<string, unknown>;
			const text = (key: string) => (typeof fields[key] === "string" ? (fields[key] as string) : undefined);
			payload = { title: text("title"), body: text("body"), path: text("path"), tag: text("tag") };
		}
	} catch {
		// A payload that is not JSON still shows a notification.
	}
	event.waitUntil(
		sw.registration.showNotification(payload.title ?? "KnightCode Bots", {
			body: payload.body,
			tag: payload.tag,
			icon: "/icon-192.png",
			data: { url: target(payload.path) },
		}),
	);
});

sw.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const url = target((event.notification.data as { url?: string } | null)?.url);
	event.waitUntil(
		(async () => {
			const windows = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
			const open = windows.find((w) => new URL(w.url).origin === sw.location.origin);
			if (!open) return sw.clients.openWindow(url);
			await open.navigate(url);
			return open.focus();
		})(),
	);
});

// A module, so these types stay local; the built file has no imports or exports.
export {};
