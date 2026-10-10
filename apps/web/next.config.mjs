import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Quick tunnels (cloudflared) hand out a random *.trycloudflare.com host;
  // without this the dev server blocks its own HMR assets over that origin.
  allowedDevOrigins: ["*.trycloudflare.com"],
  images: {
    qualities: [75, 92],
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com", pathname: "/vi/**" },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/docs/:path*.md',
        destination: '/llms.mdx/docs/:path*',
      },
    ];
  },
  async redirects() {
    return [
      { source: "/docs/getting-started", destination: "/docs/quickstart", permanent: true },
      { source: "/docs/getting-started/workspace", destination: "/docs/run/usage", permanent: true },
      { source: "/docs/features/command-menu", destination: "/docs/reference/slash-commands", permanent: true },
      { source: "/docs/features/tasks", destination: "/docs/run/sessions", permanent: true },
      { source: "/docs/features/todo", destination: "/docs/run/sessions", permanent: true },
      { source: "/docs/features/approvals", destination: "/docs/run/security", permanent: true },
      { source: "/docs/features/themes", destination: "/docs/customize/themes", permanent: true },
      { source: "/docs/ai/providers", destination: "/docs/reference/providers", permanent: true },
      { source: "/docs/ai/composer", destination: "/docs/run/usage", permanent: true },
      { source: "/docs/ai/plans-and-subagents", destination: "/docs/build/extensions", permanent: true },
      { source: "/docs/ai/sessions-and-memory", destination: "/docs/run/sessions", permanent: true },
      { source: "/docs/ai/security", destination: "/docs/run/security", permanent: true },
      { source: "/docs/reference/data", destination: "/docs/customize/configuration", permanent: true },
      { source: "/docs/reference/shortcuts", destination: "/docs/reference/keybindings", permanent: true },
      // The desktop IDE was discontinued; keep its old links from 404ing.
      { source: "/ide", destination: "/", permanent: false },
      { source: "/docs/ide/:path*", destination: "/docs", permanent: false },
    ]
  },
}

export default withMDX(nextConfig)
