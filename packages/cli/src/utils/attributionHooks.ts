// TODO: commit-attribution hooks are not implemented yet. Post-compact cleanup
// sweeps the file-content cache this module maintains, but only inside a
// dead-code-eliminated feature guard, so this is inert until the feature lands.

export async function sweepFileContentCache(): Promise<void> {}
