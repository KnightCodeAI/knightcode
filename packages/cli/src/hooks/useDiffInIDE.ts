// TODO: showing a tool's diff in the connected IDE (VS Code/JetBrains) is part
// of IDE integration, which is out of scope. With no IDE connected the file
// permission dialog renders its own diff inline; this reports "not showing in
// IDE".
export function useDiffInIDE(_props: unknown): {
  closeTabInIDE: () => void
  showingDiffInIDE: boolean
  ideName: string
  hasError: boolean
} {
  return {
    closeTabInIDE: () => {},
    showingDiffInIDE: false,
    ideName: 'IDE',
    hasError: false,
  }
}
