type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
};

export async function lockPortraitOrientation() {
  const orientation = screen.orientation as LockableScreenOrientation;
  try {
    await orientation.lock?.("portrait");
  } catch {
    // Browser tabs commonly reject orientation locks outside fullscreen/PWA mode.
  }
}

export function unlockScreenOrientation() {
  try {
    (screen.orientation as LockableScreenOrientation).unlock?.();
  } catch {
    // Unsupported browsers retain their current device orientation behavior.
  }
}
