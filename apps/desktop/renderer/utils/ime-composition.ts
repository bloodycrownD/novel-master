import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/** 判断键盘事件是否处于 IME 组字（composing）阶段。 */
export function isImeComposing(
  e: ReactKeyboardEvent | KeyboardEvent,
): boolean {
  if ("nativeEvent" in e && e.nativeEvent instanceof KeyboardEvent) {
    return e.nativeEvent.isComposing;
  }
  return (e as KeyboardEvent).isComposing === true;
}
