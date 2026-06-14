// TODO: commit/PR attribution trailers (co-author lines, enhanced PR footers)
// are part of the attribution subsystem, which pulls model-repo classification
// and remote-session ingress. This build emits no attribution trailer, so the
// /commit and /commit-push-pr prompts add no co-author/footer text.

export type AttributionTexts = {
  commit: string
  pr: string
}

export function getAttributionTexts(): AttributionTexts {
  return { commit: '', pr: '' }
}

export async function getEnhancedPRAttribution(
  _getAppState: () => unknown,
): Promise<string> {
  return ''
}
