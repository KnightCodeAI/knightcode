import { convert } from "html-to-text";
import dns from "node:dns/promises";
import net from "node:net";
import { WebFetch, type KnightcodeTool } from "@knightcode/shared";

export const tool: KnightcodeTool = WebFetch;

class SafeTargetError extends Error {}

export function isPrivateIp(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    const rest = normalized.slice(7);
    if (net.isIPv4(rest)) return isPrivateIp(rest);
    const hexParts = rest.split(":");
    if (hexParts.length === 2) {
      const high = parseInt(hexParts[0]!, 16);
      const low = parseInt(hexParts[1]!, 16);
      if (!isNaN(high) && !isNaN(low)) {
        const ipv4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
        return isPrivateIp(ipv4);
      }
    }
  }

  if (net.isIPv4(normalized)) {
    const parts = normalized.split(".").map((part) => Number(part));
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254))
      return true;
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    return false;
  }

  if (net.isIPv6(normalized)) {
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab][0-9a-f]:/.test(normalized)
    );
  }

  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "metadata.google.internal"
  );
}

async function assertSafeTarget(
  rawUrl: string,
): Promise<{ vettedIp: string; hostname: string }> {
  const u = new URL(rawUrl);
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new SafeTargetError("Only http/https URLs are allowed");
  }
  const records = await dns.lookup(u.hostname, { all: true });
  const safeRecords = records.filter((r) => !isPrivateIp(r.address));
  if (safeRecords.length === 0) {
    throw new SafeTargetError(
      "Target host resolves to no allowed public addresses",
    );
  }
  return { vettedIp: safeRecords[0]!.address, hostname: u.hostname };
}

export async function execute(input: unknown): Promise<unknown> {
  const { url, prompt, max_length } = WebFetch.input_schema.parse(input);
  const maxLength = max_length ?? 20_000;

  const { vettedIp, hostname } = await assertSafeTarget(url);
  const u = new URL(url);
  u.hostname = vettedIp.includes(":") ? `[${vettedIp}]` : vettedIp;
  const targetUrl = u.toString();

  const response = await fetch(targetUrl, {
    redirect: "error",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; KnightCode/1.0; +https://knightcode.dev)",
      Accept: "text/html, application/xhtml+xml, text/plain",
      Host: hostname,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > maxLength * 5) {
    throw new Error("Response too large to fetch safely");
  }
  if (!response.body) throw new Error("Response body is null");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let accumulatedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        accumulatedBytes += value.byteLength;
        if (accumulatedBytes > maxLength * 5) {
          await reader.cancel();
          throw new Error("Response too large to fetch safely");
        }
        raw += decoder.decode(value, { stream: true });
      }
    }
    raw += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  let text: string;
  if (contentType.includes("text/html") || contentType.includes("xhtml")) {
    text = convert(raw, {
      wordwrap: 120,
      selectors: [
        { selector: "img", format: "skip" },
        { selector: "script", format: "skip" },
        { selector: "style", format: "skip" },
        { selector: "nav", format: "skip" },
        { selector: "footer", format: "skip" },
        { selector: "a", options: { ignoreHref: true } },
      ],
    });
  } else {
    text = raw;
  }

  const truncated = text.length > maxLength;
  return {
    content: truncated ? text.slice(0, maxLength) : text,
    truncated,
    totalLength: text.length,
    url,
    prompt,
  };
}
