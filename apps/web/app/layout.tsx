import type { Metadata, Viewport } from "next"
import { Geist_Mono, Inter } from "next/font/google"

import { BackgroundWaves } from "@/components/site/background-waves"
import { ThemeProvider } from "@/components/theme-provider"
import { SITE } from "@/lib/site"
import { cn } from "@/lib/utils"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} - ${SITE.tagline}`,
    template: `%s - ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [
    "AI terminal",
    "AI agent",
    "AI coding assistant",
    "agentic coding",
    "React terminal",
    "TUI",
    "OpenTUI",
    "terminal coding agent",
    "BYOK",
    "developer tools",
    "open source agent",
  ],
  authors: [{ name: "KnightCode", url: SITE.github }],
  creator: "KnightCode",
  publisher: "KnightCode",
  alternates: { canonical: SITE.url },
  openGraph: {
    type: "website",
    url: SITE.url,
    title: `${SITE.name} - ${SITE.tagline}`,
    description: SITE.description,
    siteName: SITE.name,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} - ${SITE.tagline}`,
    description: SITE.description,
  },
  icons: {
    icon: [
      { url: "/knightcode_icon_256.png", sizes: "256x256", type: "image/png" },
      { url: "/knightcode-icon.png", sizes: "1024x1024", type: "image/png" },
    ],
    apple: [{ url: "/knightcode_icon_256.png", sizes: "256x256" }],
    shortcut: ["/knightcode_icon_256.png"],
  },
  category: "technology",
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        inter.variable
      )}
    >
      <body>
        <ThemeProvider defaultTheme="dark">
          <BackgroundWaves />
          {children}
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
