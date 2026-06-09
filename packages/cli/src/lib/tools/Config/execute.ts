import { Config, type KnightcodeTool } from "@repo/shared";
import {
  isSupportedSetting,
  getSettingMeta,
  getSettingValue,
  setSettingValue,
} from "../../settings";

export const tool: KnightcodeTool = Config;

export async function execute(input: unknown): Promise<unknown> {
  const { setting, value } = Config.input_schema.parse(input);

  if (!isSupportedSetting(setting)) {
    return { success: false, error: `Unknown setting: "${setting}"` };
  }
  const meta = getSettingMeta(setting)!;

  // GET
  if (value === undefined) {
    return {
      success: true,
      operation: "get",
      setting,
      value: getSettingValue(setting),
    };
  }

  // SET — coerce + validate
  let finalValue: string | number | boolean = value;
  if (meta.type === "boolean") {
    if (typeof value === "string") {
      const l = value.toLowerCase().trim();
      if (l === "true") finalValue = true;
      else if (l === "false") finalValue = false;
    }
    if (typeof finalValue !== "boolean") {
      return {
        success: false,
        operation: "set",
        setting,
        error: `${setting} requires true or false.`,
      };
    }
  }
  if (meta.options && !meta.options.includes(String(finalValue))) {
    return {
      success: false,
      operation: "set",
      setting,
      error: `Invalid value "${value}". Options: ${meta.options.join(", ")}`,
    };
  }

  const previousValue = getSettingValue(setting);
  setSettingValue(setting, finalValue);
  return {
    success: true,
    operation: "set",
    setting,
    previousValue,
    newValue: finalValue,
  };
}
