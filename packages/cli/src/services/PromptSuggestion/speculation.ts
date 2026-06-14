// TODO: prompt speculation (speculative pre-execution of the next query) is
// driven by the query/suggestion subsystem and is not wired here. Aborting is a
// no-op; the active-speculation type is preserved for the input surface.
import type { SpeculationState } from '../../state/AppStateStore.js'

export type ActiveSpeculationState = Extract<
  SpeculationState,
  { status: 'active' }
>

export function abortSpeculation(
  _setAppState: (f: (prev: any) => any) => void,
): void {}

export async function handleSpeculationAccept(..._args: any[]): Promise<any> { return null }
