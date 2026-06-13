// OS-level sandboxing is inert until the sandbox layer lands (see
// utils/sandbox/sandbox-adapter.ts). Commands run unsandboxed, so this always
// reports false. Accepts the raw tool input the way the real helper does, so
// callers — and the real implementation that replaces it — need no changes.
export function shouldUseSandbox(_input: { [key: string]: unknown }): boolean {
  return false
}
