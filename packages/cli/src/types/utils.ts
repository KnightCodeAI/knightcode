/**
 * Shared type-level helpers.
 */

/**
 * Recursively marks every property of T as readonly (arrays, maps, sets, and
 * nested objects included). Functions are passed through untouched.
 */
export type DeepImmutable<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends (infer E)[]
    ? ReadonlyArray<DeepImmutable<E>>
    : T extends Map<infer K, infer V>
      ? ReadonlyMap<DeepImmutable<K>, DeepImmutable<V>>
      : T extends Set<infer M>
        ? ReadonlySet<DeepImmutable<M>>
        : T extends object
          ? { readonly [K in keyof T]: DeepImmutable<T[K]> }
          : T
