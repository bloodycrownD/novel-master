import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { isImeComposing } from "./ime-composition";

/** 多行：Enter 换行；Ctrl/Cmd+Enter 提交；composing 时忽略。 */
export function handleMultilineSubmitKeyDown(
  e: ReactKeyboardEvent,
  onSubmit: () => void,
  opts?: { disabled?: boolean },
): void {
  if (isImeComposing(e) || opts?.disabled) {
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    onSubmit();
  }
}

/** 单行：Enter 提交；composing 时忽略。 */
export function handleSingleLineSubmitKeyDown(
  e: ReactKeyboardEvent,
  onSubmit: () => void,
): void {
  if (isImeComposing(e)) {
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    onSubmit();
  }
}
