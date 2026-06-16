"use client"

import { Button } from "@/components/ui/button"
import { Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTheme } from "next-themes"
import * as React from "react"
import { usePlatform } from "./platform-detect"

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  const platform = usePlatform()

  React.useEffect(() => {
    // hydration-safe mount flag - must run after mount
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  const isDark = mounted && resolvedTheme === "dark"
  const shortcutLabel = platform === "mac" ? "⌥D" : "Alt+D"

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={`Toggle theme (press ${shortcutLabel})`}
      title={`Toggle theme (press ${shortcutLabel})`}
      aria-pressed={mounted ? isDark : undefined}
      onClick={() => {
        if (!mounted) return
        setTheme(resolvedTheme === "dark" ? "light" : "dark")
      }}
      className="rounded-full"
    >
      <HugeiconsIcon
        icon={mounted ? (isDark ? Sun03Icon : Moon02Icon) : Moon02Icon}
        strokeWidth={2}
      />
    </Button>
  )
}
