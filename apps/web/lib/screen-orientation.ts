type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
};

export async function lockPortraitOrientation() {
  try {
    await (screen.orientation as LockableScreenOrientation).lock?.("portrait");
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
