import assert from "node:assert/strict";
import test from "node:test";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  handleMultilineSubmitKeyDown,
  handleSingleLineSubmitKeyDown,
} from "@/utils/textarea-enter-shortcuts";

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

function mockReactKeyDown(init: {
  key?: string;
  composing?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}): ReactKeyboardEvent & { prevented: boolean } {
  let prevented = false;
  const native = new KeyboardEvent(init.key ?? "Enter", {});
  Object.defineProperty(native, "isComposing", {
    value: init.composing ?? false,
  });
  return {
    nativeEvent: native,
    key: init.key ?? "",
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    preventDefault: () => {
      prevented = true;
    },
    get prevented() {
      return prevented;
    },
  } as ReactKeyboardEvent & { prevented: boolean };
}

test("handleMultilineSubmitKeyDown：Ctrl/Cmd+Enter 提交", () => {
  let called = false;
  const e = mockReactKeyDown({ key: "Enter", ctrlKey: true });
  handleMultilineSubmitKeyDown(e, () => {
    called = true;
  });
  assert.equal(called, true);
  assert.equal(e.prevented, true);

  called = false;
  const meta = mockReactKeyDown({ key: "Enter", metaKey: true });
  handleMultilineSubmitKeyDown(meta, () => {
    called = true;
  });
  assert.equal(called, true);
  assert.equal(meta.prevented, true);
});

test("handleMultilineSubmitKeyDown：Enter 不提交", () => {
  let called = false;
  const e = mockReactKeyDown({ key: "Enter" });
  handleMultilineSubmitKeyDown(e, () => {
    called = true;
  });
  assert.equal(called, false);
  assert.equal(e.prevented, false);
});

test("handleMultilineSubmitKeyDown：composing 或 disabled 时忽略", () => {
  let called = false;
  const composing = mockReactKeyDown({ key: "Enter", ctrlKey: true, composing: true });
  handleMultilineSubmitKeyDown(composing, () => {
    called = true;
  });
  assert.equal(called, false);

  const disabled = mockReactKeyDown({ key: "Enter", ctrlKey: true });
  handleMultilineSubmitKeyDown(
    disabled,
    () => {
      called = true;
    },
    { disabled: true },
  );
  assert.equal(called, false);
});

test("handleSingleLineSubmitKeyDown：Enter 提交", () => {
  let called = false;
  const e = mockReactKeyDown({ key: "Enter" });
  handleSingleLineSubmitKeyDown(e, () => {
    called = true;
  });
  assert.equal(called, true);
  assert.equal(e.prevented, true);
});

test("handleSingleLineSubmitKeyDown：composing 时不提交", () => {
  let called = false;
  const e = mockReactKeyDown({ key: "Enter", composing: true });
  handleSingleLineSubmitKeyDown(e, () => {
    called = true;
  });
  assert.equal(called, false);
  assert.equal(e.prevented, false);
});
