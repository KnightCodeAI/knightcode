import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins"
import { defineDocs, defineConfig } from "fumadocs-mdx/config"

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
})

export default defineConfig({
  mdxOptions: {
    // CLI docs fence languages such as `tmux` are not Shiki grammars.
    rehypeCodeOptions: {
      ...rehypeCodeDefaultOptions,
      fallbackLanguage: "text",
    },
  },
})
