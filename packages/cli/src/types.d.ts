declare module "safe-regex" {
  function safe(re: RegExp | string, options?: { limit?: number }): boolean;
  export = safe;
}
