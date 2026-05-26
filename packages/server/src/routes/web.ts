import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { convert } from "html-to-text";
import dns from "node:dns/promises";
import net from "node:net";
import { z } from "zod";
import { searchTavily } from "../lib/tavily";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { requireCreditsBalance } from "../middleware/require-credits-balance";

const searchSchema = z.object({
  query: z.string(),
  maxResults: z.number().optional().default(5),
});

const fetchSchema = z.object({
  url: z.url(),
  maxLength: z.number().int().min(1).max(200_000).optional().default(20_000),
});

function isPrivateIp(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (net.isIPv4(normalized)) {
    const parts = normalized.split(".").map((part) => Number(part));
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)) {
      return true;
    }
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
      normalized.startsWith("fe80:")
    );
  }

  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "metadata.google.internal"
  );
}

async function assertSafeTarget(rawUrl: string) {
  const u = new URL(rawUrl);
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error("Only http/https URLs are allowed");
  }
  const records = await dns.lookup(u.hostname, { all: true });
  if (records.some((r) => isPrivateIp(r.address))) {
    throw new Error("Target host is not allowed");
  }
}

const app = new Hono<AuthenticatedEnv>()
  .post(
    "/search",
    requireCreditsBalance,
    zValidator("json", searchSchema),
    async (c) => {
      const { query, maxResults } = c.req.valid("json");
      try {
        const results = await searchTavily(query, maxResults);
        return c.json(results);
      } catch (error) {
        return c.json({ error: (error as Error).message }, 500);
      }
    },
  )
  .post(
    "/fetch",
    requireCreditsBalance,
    zValidator("json", fetchSchema),
    async (c) => {
      const { url, maxLength } = c.req.valid("json");
      try {
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
          return c.json(
            { error: `HTTP ${response.status}: ${response.statusText}` },
            502,
          );
        }
        const contentType = response.headers.get("content-type") ?? "";
        const contentLength = Number(
          response.headers.get("content-length") ?? "0",
        );
        if (contentLength > maxLength * 5) {
          return c.json({ error: "Response too large to fetch safely" }, 413);
        }
        if (!response.body) {
          return c.json({ error: "Response body is null" }, 502);
        }

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
                return c.json(
                  { error: "Response too large to fetch safely" },
                  413,
                );
              }
              raw += decoder.decode(value, { stream: true });
            }
          }
          raw += decoder.decode();
        } finally {
          reader.releaseLock();
        }

        let text: string;

        if (
          contentType.includes("text/html") ||
          contentType.includes("xhtml")
        ) {
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
        return c.json({
          content: truncated ? text.slice(0, maxLength) : text,
          truncated,
          totalLength: text.length,
          url,
        });
      } catch (error) {
        return c.json({ error: (error as Error).message }, 500);
      }
    },
  );

export default app;
