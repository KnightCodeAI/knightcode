// Dev-only React DevTools hook. The upstream reconciler dynamically imports
// this module under `NODE_ENV === 'development'` to connect to the standalone
// React DevTools app (see reconciler.ts). The vendored source omitted it; this
// no-op stub keeps the dynamic import resolvable without pulling in the
// `react-devtools-core` dependency. Wire up a real connection here if in-TUI
// component inspection is ever needed during development.
export {}
