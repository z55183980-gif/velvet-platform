type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
};

export async function lockPortraitOrientation() {
  const orientation = screen.orientation as LockableScreenOrientation;
  try {
    if (!orientation.lock) throw new Error("orientation lock unsupported");
    await orientation.lock("portrait");
    document.documentElement.removeAttribute("data-portrait-lock-fallback");
  } catch {
    // Safari tabs reject orientation locks outside installed/fullscreen mode.
    document.documentElement.setAttribute("data-portrait-lock-fallback", "true");
  }
}

export function unlockScreenOrientation() {
  document.documentElement.removeAttribute("data-portrait-lock-fallback");
  try {
    (screen.orientation as LockableScreenOrientation).unlock?.();
  } catch {
    // Unsupported browsers retain their current device orientation behavior.
  }
}
