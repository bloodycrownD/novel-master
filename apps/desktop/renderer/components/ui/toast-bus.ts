type ToastOptions = {
  actionLabel?: string;
  onAction?: () => void;
};

export type ToastState = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

type ToastListener = (state: ToastState | null) => void;

const listeners = new Set<ToastListener>();
/** 自动隐藏定时器槽（模块内 holder，对象管理）。 */
const hideTimerSlot = {
  timer: undefined as ReturnType<typeof setTimeout> | undefined,
};

/** Lightweight pub/sub for transient success/error messages. */
export function subscribeToast(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(state: ToastState | null): void {
  for (const listener of listeners) {
    listener(state);
  }
}

export function showToast(message: string, durationMs = 3200, options?: ToastOptions): void {
  emit({
    message,
    actionLabel: options?.actionLabel,
    onAction: options?.onAction,
  });
  if (hideTimerSlot.timer) {
    clearTimeout(hideTimerSlot.timer);
  }
  hideTimerSlot.timer = setTimeout(() => {
    emit(null);
  }, durationMs);
}
