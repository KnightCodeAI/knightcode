/**
 * `knightcode doctor` routing — a non-interactive health check that needs no
 * API key, so main.tsx routes it before the auth check and the interactive
 * flag parser (which would otherwise swallow `doctor` as a positional prompt).
 *
 * Unlike `mcp`, `doctor` takes no sub-args, so this is a thin shim rather than
 * a commander program.
 */

/** True when the argv invokes `knightcode doctor`. */
export function isDoctorSubcommand(argv: string[]): boolean {
  return argv[2] === 'doctor'
}

/** Run the doctor health check (handler prints + shuts down cleanly). */
export async function runDoctorCommand(version: string): Promise<void> {
  const { doctorHandler } = await import('./handlers/doctor.js')
  await doctorHandler(version)
}
