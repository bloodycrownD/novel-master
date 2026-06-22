import assert from "node:assert/strict";
import test from "node:test";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { isImeComposing } from "@/utils/ime-composition";

/** Node 测试环境无 DOM KeyboardEvent，提供最小 polyfill。 */
class MockKeyboardEvent {
  isComposing: boolean;
  key: string;

  constructor(key: string, init?: { composing?: boolean }) {
    this.key = key;
    this.isComposing = init?.composing ?? false;
  }
}

if (globalThis.KeyboardEvent == null) {
  globalThis.KeyboardEvent =
    MockKeyboardEvent as unknown as typeof globalThis.KeyboardEvent;
}

function reactKeyEvent(
  init: { key?: string; composing?: boolean },
): ReactKeyboardEvent {
  const native = new KeyboardEvent(init.key ?? "Enter", {});
  Object.defineProperty(native, "isComposing", {
    value: init.composing ?? false,
  });
  return { nativeEvent: native } as ReactKeyboardEvent;
}

test("isImeComposing 读取 React synthetic event 的 nativeEvent.isComposing", () => {
  assert.equal(isImeComposing(reactKeyEvent({ key: "Enter" })), false);
  assert.equal(
    isImeComposing(reactKeyEvent({ key: "Enter", composing: true })),
    true,
  );
});

test("isImeComposing 读取原生 KeyboardEvent.isComposing", () => {
  const e = new KeyboardEvent("Enter", {});
  assert.equal(isImeComposing(e as KeyboardEvent), false);

  Object.defineProperty(e, "isComposing", { value: true });
  assert.equal(isImeComposing(e as KeyboardEvent), true);
});
