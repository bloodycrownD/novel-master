import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolPolicyPicker } from "@/features/settings/ToolPolicyPicker";

/**
 * T-P4：desktop picker 折叠态可见，默认不渲染弹层（不占表单空间）。
 * SSR 无法触发点击展开，所以这里只断言折叠态：trigger 文案 + 不含弹层标记。
 * 展开态/交互行为靠类型检查 + 手工覆盖。
 */
test("T-P4: 折叠态渲染 trigger 文案且不常驻弹层", () => {
  const html = renderToStaticMarkup(
    <ToolPolicyPicker selected={["read"]} onChange={() => {}} />,
  );
  // trigger 文案反映选择数量
  assert.match(html, /已选工具（1\/8）/);
  assert.match(html, /▼/);
  // 折叠态下不渲染弹层（picker-modal 由 open=true 才挂）
  assert.doesNotMatch(html, /picker-modal/);
});

test("T-P4: trigger 文案边界——未选择与全选", () => {
  const none = renderToStaticMarkup(
    <ToolPolicyPicker selected={[]} onChange={() => {}} />,
  );
  assert.match(none, /未选择工具（0\/8）/);

  const all = [
    "task",
    "read",
    "write",
    "edit",
    "fs",
    "glob",
    "grep",
    "skill",
  ];
  const full = renderToStaticMarkup(
    <ToolPolicyPicker selected={all} onChange={() => {}} />,
  );
  assert.match(full, /全部工具（8\/8）/);
});
