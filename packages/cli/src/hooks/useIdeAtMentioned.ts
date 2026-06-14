// TODO: IDE @-mention bridging belongs to the IDE integration subsystem and is
// not wired here.
export type IDEAtMentioned = {
  filePath: string
  lineStart?: number
  lineEnd?: number
}

export function useIdeAtMentioned(
  _mcpClients: unknown[],
  _onAtMentioned: (atMentioned: IDEAtMentioned) => void,
): void {}
