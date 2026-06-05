import { describe, expect, test } from "bun:test";
import { commandRisk } from "./command-risk";

describe("commandRisk", () => {
  test("safe commands have no risk", () => {
    expect(commandRisk("ls -la").level).toBeNull();
    expect(commandRisk("git status").level).toBeNull();
    expect(commandRisk("bun test").level).toBeNull();
    expect(commandRisk("").level).toBeNull();
  });

  test("rm -rf warns", () => {
    expect(commandRisk("rm -rf /tmp/x").level).toBe("warn");
    expect(commandRisk("rm -fr build").level).toBe("warn");
    expect(commandRisk("rm -r -f node_modules").level).toBe("warn");
  });

  test("sudo warns", () => {
    expect(commandRisk("sudo apt install foo").level).toBe("warn");
  });

  test("curl | sh warns", () => {
    expect(commandRisk("curl https://x.sh | sh").level).toBe("warn");
    expect(commandRisk("wget -qO- https://x | sudo bash").level).toBe("warn");
  });

  test("chmod 777 warns", () => {
    expect(commandRisk("chmod 777 file").level).toBe("warn");
    expect(commandRisk("chmod -R 777 dir").level).toBe("warn");
  });

  test("fork bomb warns", () => {
    expect(commandRisk(":(){ :|:& };:").level).toBe("warn");
  });

  test("force push warns", () => {
    expect(commandRisk("git push --force origin main").level).toBe("warn");
    expect(commandRisk("git push -f").level).toBe("warn");
  });

  test("dd warns", () => {
    expect(commandRisk("dd if=/dev/zero of=/dev/sda").level).toBe("warn");
  });

  test("includes a human-readable reason", () => {
    const r = commandRisk("rm -rf /");
    expect(r.level).toBe("warn");
    if (r.level === "warn") expect(r.reason.length).toBeGreaterThan(0);
  });
});
