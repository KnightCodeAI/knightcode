import { spawnSync } from "child_process";

export function copyToClipboard(text: string): boolean {
  const platform = process.platform;
  let result: ReturnType<typeof spawnSync>;

  if (platform === "win32") {
    result = spawnSync("clip.exe", [], { input: text, encoding: "utf-8" });
  } else if (platform === "darwin") {
    result = spawnSync("pbcopy", [], { input: text, encoding: "utf-8" });
  } else {
    result = spawnSync("xclip", ["-selection", "clipboard"], {
      input: text,
      encoding: "utf-8",
    });
    if (result.status !== 0) {
      result = spawnSync("xsel", ["--clipboard", "--input"], {
        input: text,
        encoding: "utf-8",
      });
    }
  }

  return result.status === 0;
}
