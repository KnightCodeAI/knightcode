export function areExperimentalFeaturesEnabled(): boolean {
	return process.env.KNIGHTCODE_EXPERIMENTAL === "1";
}
