// Publish packages/cli/docs as the website manual. The site used to keep a
// second guide, and that guide drifted into describing a different product.
// Re-run this before `next dev` / `next build`. Do not edit content/docs by hand
// except through scripts/ide-doc.mdx.

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, posix } from "node:path"
import { fileURLToPath } from "node:url"

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = join(webRoot, "..", "..")
const cliDocs = join(repoRoot, "packages", "cli", "docs")
const outDir = join(webRoot, "content", "docs")
const imageOut = join(webRoot, "public", "docs", "images")
const ideTemplate = join(webRoot, "scripts", "ide-doc.mdx")

const FOLDER_SLUGS = {
	"Run KnightCode": "run",
	"Customize KnightCode": "customize",
	"Build on KnightCode": "build",
	Reference: "reference",
}

const FOLDER_ICONS = {
	run: "Terminal",
	customize: "PaintBrush",
	build: "Code",
	reference: "BookOpen",
}

const ALLOWED_TAGS = new Set([
	"a",
	"p",
	"img",
	"br",
	"code",
	"em",
	"strong",
	"hr",
	"sup",
	"sub",
	"kbd",
	"details",
	"summary",
	"table",
	"thead",
	"tbody",
	"tr",
	"th",
	"td",
	"ul",
	"ol",
	"li",
	"blockquote",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"div",
	"span",
	"pre",
	"caption",
])

const VOID_TAGS = new Set(["img", "br", "hr"])

const navigation = JSON.parse(readFileSync(join(cliDocs, "docs.json"), "utf8")).navigation

const urlByFile = new Map()
const outputs = []
const metas = []

function folderSlug(title) {
	if (title === "Get Started" || title === "Guides") return null
	return FOLDER_SLUGS[title] ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

function walk(nodes, segments, bucket) {
	for (const node of nodes) {
		if (node.path) {
			const slug = node.path.replace(/\.md$/, "")
			const parts = [...segments]
			if (!(segments.length === 0 && slug === "index")) parts.push(slug)
			const url = parts.length === 0 ? "/docs" : `/docs/${parts.join("/")}`
			if (urlByFile.has(node.path)) throw new Error(`Duplicate doc: ${node.path}`)
			urlByFile.set(node.path, url)
			bucket.push(slug)
			outputs.push({ file: node.path, segments: [...segments], slug })
			continue
		}
		const seg = folderSlug(node.title)
		if (seg == null) {
			if (bucket.length > 0) bucket.push(`---${node.title}---`)
			walk(node.items, segments, bucket)
			continue
		}
		const child = []
		walk(node.items, [...segments, seg], child)
		metas.push({ segments: [...segments, seg], title: node.title, pages: child })
		bucket.push(seg)
	}
}

const rootPages = []
walk(navigation, [], rootPages)
rootPages.push("---Desktop IDE---", "ide")

const listed = new Set(urlByFile.keys())
for (const name of readdirSync(cliDocs)) {
	if (name.endsWith(".md") && !listed.has(name)) {
		throw new Error(`CLI doc is not in docs.json navigation: ${name}`)
	}
}

function rewriteHref(href, from) {
	if (/^(https?:|mailto:|#|\/)/.test(href)) return href
	const md = href.match(/^(?:\.\/)?([^#)]+?\.md)(#.*)?$/)
	if (md) {
		const target = urlByFile.get(md[1])
		if (!target) throw new Error(`${from} links to unknown doc ${href}`)
		return target + (md[2] ?? "")
	}
	const img = href.match(/^(?:\.\/)?images\/([^#?]+)$/)
	if (img) return `/docs/images/${img[1]}`
	if (href.startsWith(".")) {
		const hash = href.includes("#") ? `#${href.slice(href.indexOf("#") + 1)}` : ""
		const raw = hash ? href.slice(0, href.indexOf("#")) : href
		const resolved = posix.normalize(posix.join("packages/cli/docs", posix.dirname(from), raw)).replace(/\/$/, "")
		if (resolved.startsWith("..")) throw new Error(`${from} escapes the repo: ${href}`)
		const kind = raw.endsWith("/") ? "tree" : "blob"
		return `https://github.com/KnightCodeAI/knightcode/${kind}/main/${resolved}${hash}`
	}
	if (href.includes(".md")) throw new Error(`${from} has an unrewritten relative link: ${href}`)
	return href
}

function rewriteMarkdown(text, from) {
	return text.replace(/(!?\[[^\]]*\]\()([^)\s]+)(\))/g, (_all, open, href, close) => {
		return open + rewriteHref(href, from) + close
	})
}

function escapeProse(text) {
	let out = ""
	for (let i = 0; i < text.length; i++) {
		const c = text[i]
		if (c === "{" || c === "}") {
			out += `\\${c}`
			continue
		}
		if (c !== "<") {
			out += c
			continue
		}
		const rest = text.slice(i)
		if (rest.startsWith("<!--")) {
			const end = rest.indexOf("-->")
			if (end !== -1) {
				out += rest.slice(0, end + 3)
				i += end + 2
				continue
			}
		}
		const url = rest.match(/^<(https?:\/\/[^>\s]+)>/)
		if (url) {
			out += url[1]
			i += url[0].length - 1
			continue
		}
		const tag = rest.match(/^<\/?([A-Za-z][\w:-]*)\b[^<>]*?\/?>/)
		if (tag && ALLOWED_TAGS.has(tag[1].toLowerCase())) {
			let raw = tag[0]
			const name = tag[1].toLowerCase()
			if (name === "img") raw = raw.replace(/src="(?:\.\/)?images\//g, 'src="/docs/images/')
			if (VOID_TAGS.has(name) && !raw.endsWith("/>")) raw = raw.replace(/>$/, " />")
			out += raw
			i += tag[0].length - 1
			continue
		}
		out += "&lt;"
	}
	return out
}

function maskCode(markdown) {
	const blocks = []
	const fenced = markdown.replace(/(^|\n)( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2\3[^\n]*/g, (block) => {
		const token = `\u0000CODE${blocks.length}\u0000`
		blocks.push(block)
		return token
	})
	const masked = fenced.replace(/(`+)[\s\S]*?\1/g, (span) => {
		const token = `\u0000CODE${blocks.length}\u0000`
		blocks.push(span)
		return token
	})
	return { masked, blocks }
}

function unmask(text, blocks) {
	return text.replace(/\u0000CODE(\d+)\u0000/g, (_all, index) => blocks[Number(index)])
}

function stripTitle(markdown, file) {
	const lines = markdown.split("\n")
	const index = lines.findIndex((line) => line.startsWith("# "))
	if (index === -1) throw new Error(`${file} has no H1`)
	const title = lines[index].slice(2).trim()
	const body = [...lines.slice(0, index), ...lines.slice(index + 1)].join("\n").replace(/^\n+/, "")
	return { title, body }
}

function describe(body) {
	const lines = body.split("\n")
	const para = []
	let started = false
	for (const line of lines) {
		const trimmed = line.trim()
		if (!started) {
			if (trimmed === "" || trimmed.startsWith("<") || trimmed.startsWith("!") || trimmed.startsWith("#") || trimmed.startsWith("|")) {
				continue
			}
			started = true
		}
		if (trimmed === "") break
		para.push(trimmed)
	}
	const text = para
		.join(" ")
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/<[^>]+>/g, "")
		.replace(/\s+/g, " ")
		.trim()
	if (text.length <= 180) return text
	const cut = text.slice(0, 177)
	const space = cut.lastIndexOf(" ")
	return `${(space > 80 ? cut.slice(0, space) : cut).trimEnd()}...`
}

function transform(markdown, file) {
	const normalized = markdown.replace(/\r\n/g, "\n")
	const { title, body } = stripTitle(normalized, file)
	const { masked, blocks } = maskCode(body)
	const rewritten = rewriteMarkdown(masked, file)
	const escaped = escapeProse(rewritten)
	const restored = unmask(escaped, blocks).trim()
	const description = describe(restored) || title
	return `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\n---\n\n{/* Generated from packages/cli/docs/${file} by apps/web/scripts/sync-cli-docs.mjs. Do not edit. */}\n\n${restored}\n`
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
rmSync(imageOut, { recursive: true, force: true })
cpSync(join(cliDocs, "images"), imageOut, { recursive: true })

for (const output of outputs) {
	const markdown = readFileSync(join(cliDocs, output.file), "utf8")
	const dir = join(outDir, ...output.segments)
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, `${output.slug}.mdx`), transform(markdown, output.file))
}

for (const meta of metas) {
	const dir = join(outDir, ...meta.segments)
	mkdirSync(dir, { recursive: true })
	const icon = FOLDER_ICONS[meta.segments[meta.segments.length - 1]]
	const payload = { title: meta.title, pages: meta.pages }
	if (icon) payload.icon = icon
	writeFileSync(join(dir, "meta.json"), `${JSON.stringify(payload, null, 2)}\n`)
}

mkdirSync(join(outDir, "ide"), { recursive: true })
writeFileSync(join(outDir, "ide", "index.mdx"), readFileSync(ideTemplate, "utf8"))
writeFileSync(
	join(outDir, "ide", "meta.json"),
	`${JSON.stringify({ title: "Desktop IDE", icon: "CodeFolder", pages: ["index"] }, null, 2)}\n`,
)
writeFileSync(join(outDir, "meta.json"), `${JSON.stringify({ pages: rootPages }, null, 2)}\n`)

function bareExpressions(markdown) {
	const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
	const { masked } = maskCode(body)
	const problems = []
	for (let i = 0; i < masked.length; i++) {
		const c = masked[i]
		if ((c === "{" || c === "}") && masked[i - 1] !== "\\") {
			problems.push(masked.slice(Math.max(0, i - 24), i + 24).replaceAll("\n", " "))
		}
		if (c !== "<") continue
		const rest = masked.slice(i)
		const tag = rest.match(/^<\/?([A-Za-z][\w:-]*)\b[^<>]*?\/?>/)
		if (tag && ALLOWED_TAGS.has(tag[1].toLowerCase())) {
			i += tag[0].length - 1
			continue
		}
		if (rest.startsWith("<!--")) continue
		problems.push(rest.slice(0, 40).replaceAll("\n", " "))
	}
	return problems
}

for (const output of outputs) {
	const generated = readFileSync(join(outDir, ...output.segments, `${output.slug}.mdx`), "utf8")
	const problems = bareExpressions(generated)
	if (problems.length > 0) {
		throw new Error(`${output.file} still has MDX-sensitive text outside code: ${problems.slice(0, 8).join(" | ")}`)
	}
}

const quickstart = readFileSync(join(outDir, "quickstart.mdx"), "utf8")
if (quickstart.includes("](quickstart.md)") || quickstart.includes("OpenTUI")) {
	throw new Error("sync-cli-docs left a stale link or phrase in quickstart.mdx")
}
const usage = readFileSync(join(outDir, "run", "usage.mdx"), "utf8")
if (!usage.includes("](/docs/quickstart)") || !usage.includes('src="/docs/images/')) {
	throw new Error("sync-cli-docs did not rewrite usage.md links or images")
}

console.log(`synced ${outputs.length} CLI docs and the IDE page`)
