// Vitest global setup: the emulators are started by the config (the Worker's bindings need their URLs); this only
// stops them when the run ends.
import { stopEmulators } from "./emulators.ts";

export default function setup(): () => Promise<void> {
	return stopEmulators;
}
