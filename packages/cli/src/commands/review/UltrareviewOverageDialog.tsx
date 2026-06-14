// TODO: the Extra-Usage confirmation dialog for cloud ultrareview is out of
// scope (the remote review never launches). Inert: renders nothing.
export function UltrareviewOverageDialog(_props: {
  onProceed: (signal: AbortSignal) => Promise<void> | void
  onCancel: () => void
}): null {
  return null
}
