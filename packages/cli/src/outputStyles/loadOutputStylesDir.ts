// TODO: output-style discovery (reading markdown style files from the
// output-styles dirs) lands with the output-style phase. Until then only the
// built-in default style exists, so directory discovery yields nothing.
import type { OutputStyleConfig } from '../constants/outputStyles.js'

export async function getOutputStyleDirStyles(
  _cwd: string,
): Promise<OutputStyleConfig[]> {
  return []
}

export function clearOutputStyleCaches(): void {}
