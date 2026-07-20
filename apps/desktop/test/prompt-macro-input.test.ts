/**
 * T-M2 / T-M5：Desktop 动态区宏高亮契约与原子删（Backspace / Delete）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  renderPromptMacroHighlightHtml,
  tryAtomicMacroDelete,
} from "@/features/settings/prompt-macro-input";

/** 模拟退格一次：删掉 cursor 前一字 */
function backspaceOnce(value: string, cursor: number): string {
  if (cursor <= 0) {
    return value;
  }
  return value.slice(0, cursor - 1) + value.slice(cursor);
}

/** 模拟 Delete 一次：删掉 cursor 后一字 */
function deleteForwardOnce(value: string, cursor: number): string {
  if (cursor >= value.length) {
    return value;
  }
  return value.slice(0, cursor) + value.slice(cursor + 1);
}

test("T-M5: 高亮 HTML 含 prompt-macro__token；value 无 span markup", () => {
  const value = "前缀{{$time}}后缀";
  const html = renderPromptMacroHighlightHtml(value);
  assert.match(html, /prompt-macro__token/);
  assert.match(html, /\{\{\$time\}\}/);
  assert.equal(value.includes("<span"), false);
  assert.equal(value.includes("prompt-macro"), false);
});

test("T-M5: 非法/残缺宏不高亮", () => {
  const value = "{{$unknown}} typing {{$time";
  const html = renderPromptMacroHighlightHtml(value);
  assert.equal(html.includes("prompt-macro__token"), false);
  assert.equal(html, value.replace(/&/g, "&amp;"));
});

test("T-M2: Backspace 碰到 {{$time}} 整段删", () => {
  const prev = "前缀{{$time}}后缀";
  const macroStart = prev.indexOf("{{$time}}");
  const cursorInside = macroStart + "{{$time".length;
  const changed = backspaceOnce(prev, cursorInside);
  assert.equal(tryAtomicMacroDelete(prev, changed), "前缀后缀");
});

test("T-M2: Delete 碰到 {{$time}} 整段删（与 Backspace 对称）", () => {
  const prev = "前缀{{$time}}后缀";
  const macroStart = prev.indexOf("{{$time}}");
  const cursorAtStart = macroStart;
  const changed = deleteForwardOnce(prev, cursorAtStart);
  assert.equal(tryAtomicMacroDelete(prev, changed), "前缀后缀");
});

test("T-M3: 手输完整 {{ $week_cn }} Backspace 整段删", () => {
  const prev = "见 {{ $week_cn }} 后";
  const macroStart = prev.indexOf("{{ $week_cn }}");
  const cursorInside = macroStart + "{{ $week".length;
  const changed = backspaceOnce(prev, cursorInside);
  assert.equal(tryAtomicMacroDelete(prev, changed), "见  后");
});

test("T-M3: 手输完整 {{ $week_cn }} Delete 整段删", () => {
  const prev = "见 {{ $week_cn }} 后";
  const macroStart = prev.indexOf("{{ $week_cn }}");
  const changed = deleteForwardOnce(prev, macroStart);
  assert.equal(tryAtomicMacroDelete(prev, changed), "见  后");
});

test("T-M4: 非白名单 / 残缺不原子删", () => {
  assert.equal(
    tryAtomicMacroDelete("{{$unknown}}", backspaceOnce("{{$unknown}}", 11)),
    null
  );
  assert.equal(
    tryAtomicMacroDelete("x{{$time", backspaceOnce("x{{$time", 8)),
    null
  );
  assert.equal(
    tryAtomicMacroDelete("{{$unknown}}", deleteForwardOnce("{{$unknown}}", 0)),
    null
  );
});
