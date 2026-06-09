import { convert } from "html-to-text";
import dns from "node:dns/promises";
import net from "node:net";
import { WebFetch, type KnightcodeTool } from "@repo/shared";

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

async function assertSafeTarget(rawUrl: string): Promise<void> {
  const u = new URL(rawUrl);
  if (u.protocol === "http:") {
    u.protocol = "https:";
  }
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new SafeTargetError("Only http/https URLs are allowed");
  }
  const records = await dns.lookup(u.hostname, { all: true });
  if (records.length === 0) {
    throw new SafeTargetError("Target host does not resolve");
  }
  // We fetch by the original hostname so TLS SNI and certificate validation
  // stay correct (connecting to a bare IP would fail cert checks). That means
  // we can't pin one vetted IP at the socket layer, so the entire resolved set
  // must be public to preserve the SSRF guard.
  if (records.some((r) => isPrivateIp(r.address))) {
    throw new SafeTargetError("Target host resolves to a private address");
  }
}

export async function execute(input: unknown): Promise<unknown> {
  const { url: rawUrl, prompt, max_length } = WebFetch.input_schema.parse(input);
  const maxLength = max_length ?? 20_000;

  const u = new URL(rawUrl);
  if (u.protocol === "http:") {
    u.protocol = "https:";
  }
  const url = u.toString();

  await assertSafeTarget(url);

  const response = await fetch(url, {
    redirect: "error",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; KnightCode/1.0; +https://knightcode.dev)",
      Accept: "text/html, application/xhtml+xml, text/plain",
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
