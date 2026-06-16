import { source } from "@/lib/source"
import fs from "node:fs"
import path from "node:path"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const slugParam = searchParams.get("slug") || ""

  // Split the slug into segments.
  // For 'index', the slug segments should be [] to match the index page
  const slugSegments =
    slugParam === "index" ? [] : slugParam.split("/").filter(Boolean)

  const page = source.getPage(slugSegments)
  if (!page) {
    return new Response("Not Found", { status: 404 })
  }

  const filePath =
    page.absolutePath || path.join(process.cwd(), "content/docs", page.path)

  try {
    const rawMarkdown = fs.readFileSync(filePath, "utf-8")
    return new Response(rawMarkdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
      },
    })
  } catch (err) {
    return new Response("Error reading markdown file", { status: 500 })
  }
}
