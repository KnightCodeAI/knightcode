import { z } from "zod";

export function semanticNumber<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((val) => {
    if (typeof val === "string" && val.trim() !== "" && !isNaN(Number(val))) {
      return Number(val);
    }
    return val;
  }, schema);
}

export function semanticBoolean<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((val) => {
    if (typeof val === "string") {
      const lower = val.toLowerCase().trim();
      if (lower === "true") return true;
      if (lower === "false") return false;
    }
    return val;
  }, schema);
}
