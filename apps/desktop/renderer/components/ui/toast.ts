type ToastListener = (message: string) => void;

const listeners = new Set<ToastListener>();
let hideTimer: ReturnType<typeof setTimeout> | undefined;

/** Lightweight pub/sub for transient success/error messages. */
export function subscribeToast(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function showToast(message: string, durationMs = 2800): void {
  for (const listener of listeners) {
    listener(message);
  }
  if (hideTimer) {
    clearTimeout(hideTimer);
  }
  hideTimer = setTimeout(() => {
    for (const listener of listeners) {
      listener("");
    }
  }, durationMs);
}
