"use client";

import { nextTheme, themeToggleLabel } from "-/components/theme-cycle";
import { Button } from "@sugt/ui/components/button";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

/**
 * One icon button that toggles Light ⇄ Dark (the rotation and its `aria-label` live in
 * `theme-cycle`, which is where they are tested). The internal app owns this control rather
 * than `@sugt/ui`: the theme control is an app component, not a primitive
 * (`packages/ui/README.md`), and no `dropdown-menu`/`switch` primitive is added.
 *
 * **Hydration-safe.** `next-themes` cannot know the stored theme until it has read
 * `localStorage`, which only happens after mount, so the first server/client paint must
 * not depend on it. Until `mounted`, render a stable, theme-agnostic placeholder — the Sun
 * icon, disabled — matching what the server sent; swap to the live control once mounted.
 * Without this the button's icon and label would differ between server and client and React
 * would warn.
 */
function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // Safe placeholder pattern: the pre-mount placeholder greys itself out with `aria-disabled`
    // plus `pointer-events-none opacity-50`, never the base-ui `disabled` prop. base-ui's Button
    // renders a *focusable-when-disabled* control, and its native `disabled` attribute serializes
    // differently across the SSR/hydration boundary (server emits `disabled={null}`, the client
    // computes `disabled={true}`) — a React hydration mismatch on every signed-in page (#302). The
    // placeholder has no `onClick`, so it is already inert; these classes only preserve the greyed
    // look while keeping the markup byte-identical on server and client. Use this pattern — not
    // `disabled` — for any pre-mount base-ui placeholder.
    return (
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Tema"
        aria-disabled
        className="pointer-events-none opacity-50"
      >
        <Sun />
      </Button>
    );
  }

  const Icon = theme === "dark" ? Moon : Sun;

  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={themeToggleLabel(theme)}
      onClick={() => setTheme(nextTheme(theme))}
    >
      <Icon />
    </Button>
  );
}

export { ThemeToggle };
