import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CHAT_MODEL_ID,
  findSupportedChatModel,
  MODEL_SHORTLIST,
} from "./index";

describe("MODEL_SHORTLIST", () => {
  test("is non-empty and every id resolves to a supported model", () => {
    expect(MODEL_SHORTLIST.length).toBeGreaterThan(0);
    for (const entry of MODEL_SHORTLIST) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(findSupportedChatModel(entry.id)).toBeDefined();
    }
  });

  test("includes the default model so onboarding can preselect it", () => {
    expect(MODEL_SHORTLIST.some((m) => m.id === DEFAULT_CHAT_MODEL_ID)).toBe(
      true,
    );
  });

  test("has unique ids", () => {
    const ids = MODEL_SHORTLIST.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
