// Maintenance actions (spec section 7): Stop shuts down now (after a save), Update saves then rebuilds on the current
// image, Recover recreates a broken computer from the last save, Reset returns to the last save and discards unsaved
// changes. Each is a recorded job that holds off new runs while it works and reports its steps.
import type { ComputerProvider } from "./provider.ts";

export type MaintenanceKind = "stop" | "update" | "recover" | "reset";

export interface MaintenanceSteps {
	provider: ComputerProvider;
	id: string;
	running: boolean;
	/** Saves the workspace as a new generation. */
	save(): Promise<void>;
	/** Starts the computer from the newest completed save (snapshot or archive). */
	restore(): Promise<void>;
	progress(step: string): void;
}

export async function runMaintenance(kind: MaintenanceKind, steps: MaintenanceSteps): Promise<void> {
	const { provider, id } = steps;
	switch (kind) {
		case "stop":
			if (steps.running) {
				steps.progress("Saving the workspace");
				await steps.save();
			}
			steps.progress("Stopping");
			await provider.stop(id);
			return;
		case "update":
			if (steps.running) {
				steps.progress("Saving the workspace");
				await steps.save();
			}
			steps.progress("Rebuilding on the current image");
			await provider.destroy(id);
			await provider.provision(id);
			steps.progress("Restoring the workspace");
			await steps.restore();
			return;
		case "recover":
		case "reset":
			// Nothing unsaved is kept: a broken computer cannot be saved, and Reset discards on purpose.
			steps.progress(kind === "recover" ? "Recreating the computer" : "Discarding unsaved changes");
			await provider.destroy(id);
			await provider.provision(id);
			steps.progress("Restoring the last save");
			await steps.restore();
			return;
	}
}
