const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" aria-hidden="true"><defs><radialGradient id="kc-disc" cx="32%" cy="26%" r="88%"><stop offset="0" stop-color="#ffb473"/><stop offset=".45" stop-color="#ff7f2a"/><stop offset="1" stop-color="#d24d07"/></radialGradient><linearGradient id="kc-eye" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#ff8a3d"/><stop offset="1" stop-color="#fff3e3"/></linearGradient><filter id="kc-glow" x="-300%" y="-300%" width="700%" height="700%"><feGaussianBlur stdDeviation="1.7"/></filter></defs><circle cx="48" cy="47.4" r="43.4" fill="url(#kc-disc)"/><g fill="#0b0b0f"><path fill-rule="evenodd" d="M46.8 15.2L49.4 15.8L53.4 17.7L65.2 27.1L67.4 29.9L63.9 36.1L69.7 32.7L73.4 40.1L73.3 41.3L67.7 48.8L74.5 44.2L75.4 48.3L75.8 53.3L72.7 57.0L67.9 60.7L71.7 59.5L75.4 57.2L75.3 59.8L72.6 68.5L66.5 70.5L64.6 72.1L63.4 74.0L63.0 75.8L63.4 77.4L66.6 78.5L67.2 79.3L33.8 79.4L34.2 78.1L32.9 75.8L32.4 73.4L32.4 71.1L33.4 67.7L36.4 62.6L46.0 51.2L47.7 48.1L48.5 45.0L44.7 49.3L40.6 49.0L36.9 49.3L33.6 50.5L29.8 53.0L23.5 47.6L24.0 44.4L27.9 41.8L31.5 38.7L33.4 36.3L35.1 32.6L48.6 23.2L46.8 15.2ZM50.5 41.0L50.7 46.1L50.1 48.5L48.8 51.8L45.8 56.5L40.4 63.8L38.1 68.5L37.6 70.9L37.6 73.4L38.3 75.8L39.7 78.2L36.8 78.0L35.3 76.2L34.4 73.2L34.7 69.9L36.6 65.6L38.7 62.6L45.9 54.2L48.4 50.5L50.1 46.2L50.7 42.9L50.5 41.0Z"/><rect x="31.8" y="78.2" width="36.1" height="5.2" rx="2.2"/><rect x="29.1" y="82.7" width="42" height="9.3" rx="2.6"/></g><path d="M36.8 38.5L38.9 35.5L45.1 33.0L42.0 37.0L36.8 38.6Z" fill="#ff7a1a" filter="url(#kc-glow)"/><path d="M36.8 38.5L38.9 35.5L45.1 33.0L42.0 37.0L36.8 38.6Z" fill="url(#kc-eye)"/></svg>`;

/** OAuth provider ids, matching the flow loaders in load.ts. */
export type OAuthBrand = "anthropic" | "githubCopilot" | "kimiCoding" | "openaiCodex" | "openrouter" | "radius" | "xai";

const BRAND_LABELS: Record<OAuthBrand, string> = {
	anthropic: "Anthropic",
	githubCopilot: "GitHub Copilot",
	kimiCoding: "Kimi For Coding",
	openaiCodex: "OpenAI Codex",
	openrouter: "OpenRouter",
	radius: "Radius",
	xai: "xAI",
};

// Marks from @lobehub/icons-static-svg (MIT), each checked against the provider's own
// favicon. Radius publishes none, so it gets a neutral glyph rather than an invented logo.
const BRAND_MARKS: Record<OAuthBrand, string> = {
	anthropic: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="M13.827 3.52h3.603L24 20h-3.603l-6.57-16.48zm-7.258 0h3.767L16.906 20h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.522zm4.132 9.959L8.453 7.687 6.205 13.48H10.7z"/></svg>`,
	githubCopilot: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="M19.245 5.364c1.322 1.36 1.877 3.216 2.11 5.817.622 0 1.2.135 1.592.654l.73.964c.21.278.323.61.323.955v2.62c0 .339-.173.669-.453.868C20.239 19.602 16.157 21.5 12 21.5c-4.6 0-9.205-2.583-11.547-4.258-.28-.2-.452-.53-.453-.868v-2.62c0-.345.113-.679.321-.956l.73-.963c.392-.517.974-.654 1.593-.654l.029-.297c.25-2.446.81-4.213 2.082-5.52 2.461-2.54 5.71-2.851 7.146-2.864h.198c1.436.013 4.685.323 7.146 2.864zm-7.244 4.328c-.284 0-.613.016-.962.05-.123.447-.305.85-.57 1.108-1.05 1.023-2.316 1.18-2.994 1.18-.638 0-1.306-.13-1.851-.464-.516.165-1.012.403-1.044.996a65.882 65.882 0 00-.063 2.884l-.002.48c-.002.563-.005 1.126-.013 1.69.002.326.204.63.51.765 2.482 1.102 4.83 1.657 6.99 1.657 2.156 0 4.504-.555 6.985-1.657a.854.854 0 00.51-.766c.03-1.682.006-3.372-.076-5.053-.031-.596-.528-.83-1.046-.996-.546.333-1.212.464-1.85.464-.677 0-1.942-.157-2.993-1.18-.266-.258-.447-.661-.57-1.108-.32-.032-.64-.049-.96-.05zm-2.525 4.013c.539 0 .976.426.976.95v1.753c0 .525-.437.95-.976.95a.964.964 0 01-.976-.95v-1.752c0-.525.437-.951.976-.951zm5 0c.539 0 .976.426.976.95v1.753c0 .525-.437.95-.976.95a.964.964 0 01-.976-.95v-1.752c0-.525.437-.951.976-.951zM7.635 5.087c-1.05.102-1.935.438-2.385.906-.975 1.037-.765 3.668-.21 4.224.405.394 1.17.657 1.995.657h.09c.649-.013 1.785-.176 2.73-1.11.435-.41.705-1.433.675-2.47-.03-.834-.27-1.52-.63-1.813-.39-.336-1.275-.482-2.265-.394zm6.465.394c-.36.292-.6.98-.63 1.813-.03 1.037.24 2.06.675 2.47.968.957 2.136 1.104 2.776 1.11h.044c.825 0 1.59-.263 1.995-.657.555-.556.765-3.187-.21-4.224-.45-.468-1.335-.804-2.385-.906-.99-.088-1.875.058-2.265.394zM12 7.615c-.24 0-.525.015-.84.044.03.16.045.336.06.526l-.001.159a2.94 2.94 0 01-.014.25c.225-.022.425-.027.612-.028h.366c.187 0 .387.006.612.028-.015-.146-.015-.277-.015-.409.015-.19.03-.365.06-.526a9.29 9.29 0 00-.84-.044z"/></svg>`,
	kimiCoding: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z"/><path d="M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z"/></svg>`,
	openaiCodex: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"/></svg>`,
	openrouter: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="M18.654 3.87a5.087 5.087 0 110 10.174L23.7 19.09c.64.641.187 1.737-.72 1.737H8.48a8.479 8.479 0 010-16.958h10.175zM8.479 7.26a5.087 5.087 0 100 10.176 5.087 5.087 0 000-10.175z"/></svg>`,
	radius: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9.2"/><path d="M12 12 18.5 5.5" stroke-linecap="round"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>`,
	xai: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="M6.469 8.776L16.512 23h-4.464L2.005 8.776H6.47zm-.004 7.9l2.233 3.164L6.467 23H2l4.465-6.324zM22 2.582V23h-3.659V7.764L22 2.582zM22 1l-9.952 14.095-2.233-3.163L17.533 1H22z"/></svg>`,
};

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function renderPage(options: {
	brand: OAuthBrand;
	title: string;
	heading: string;
	message: string;
	details?: string;
}): string {
	const title = escapeHtml(options.title);
	const heading = escapeHtml(options.heading);
	const message = escapeHtml(options.message);
	const details = options.details ? escapeHtml(options.details) : undefined;
	const brandMark = BRAND_MARKS[options.brand];
	const brandLabel = escapeHtml(BRAND_LABELS[options.brand]);

	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root {
      --text: #fafafa;
      --text-dim: #a1a1aa;
      --page-bg: #09090b;
      --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    * { box-sizing: border-box; }
    html { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: var(--page-bg);
      color: var(--text);
      font-family: var(--font-sans);
      text-align: center;
    }
    main {
      width: 100%;
      max-width: 560px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .marks {
      display: flex;
      align-items: center;
      gap: 22px;
      margin-bottom: 28px;
    }
    .mark {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .mark svg { width: 100%; height: 100%; display: block; }
    .mark-brand {
      width: 40px;
      height: 40px;
      color: var(--text);
    }
    .mark-knight {
      width: 56px;
      height: 56px;
    }
    .rule {
      width: 1px;
      height: 36px;
      background: linear-gradient(180deg, transparent, rgba(250, 250, 250, 0.3), transparent);
    }
    h1 {
      margin: 0 0 10px;
      font-size: 28px;
      line-height: 1.15;
      font-weight: 650;
      color: var(--text);
    }
    p {
      margin: 0;
      line-height: 1.7;
      color: var(--text-dim);
      font-size: 15px;
    }
    .details {
      margin-top: 16px;
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--text-dim);
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <main>
    <div class="marks">
      <span class="mark mark-brand" role="img" aria-label="${brandLabel}">${brandMark}</span>
      <span class="rule"></span>
      <span class="mark mark-knight" role="img" aria-label="KnightCode">${LOGO_SVG}</span>
    </div>
    <h1>${heading}</h1>
    <p>${message}</p>
    ${details ? `<div class="details">${details}</div>` : ""}
  </main>
</body>
</html>`;
}

export function oauthSuccessHtml(brand: OAuthBrand, message: string): string {
	return renderPage({
		brand,
		title: "Authentication successful",
		heading: "Authentication successful",
		message,
	});
}

export function oauthErrorHtml(brand: OAuthBrand, message: string, details?: string): string {
	return renderPage({
		brand,
		title: "Authentication failed",
		heading: "Authentication failed",
		message,
		details,
	});
}
