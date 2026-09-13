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
}

export default withMDX(nextConfig)
