declare module 'asciichart' {
  export function plot(series: number[] | number[][], config?: any): string
  const _default: { plot: typeof plot }
  export default _default
}
