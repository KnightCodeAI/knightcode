// TODO: heap memory-usage polling is out of scope (internal /heapdump aid).

export type MemoryUsage = {
  heapUsed: number
  status: 'normal' | 'warning' | 'critical'
}

export function useMemoryUsage(): MemoryUsage | null {
  return null
}
