// TODO: API-backed token counting and the per-file-type estimation tables land
// with the context/budget layer. The Read tool uses these to bound output; a
// rough chars-per-token heuristic is enough until then.

const CHARS_PER_TOKEN = 4

export async function countTokensWithAPI(
  content: string,
): Promise<number | null> {
  return Math.ceil(content.length / CHARS_PER_TOKEN)
}

export function roughTokenCountEstimationForFileType(
  content: string,
  _fileExtension: string,
): number {
  return Math.ceil(content.length / CHARS_PER_TOKEN)
}
