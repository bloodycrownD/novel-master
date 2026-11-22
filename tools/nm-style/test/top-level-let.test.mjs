// T-TL1~T-TL6：top-level-let 规则——顶层/namespace 内 let 正例、函数体负例、
// keep-top-let 豁免、对象槽负例、blocking 恒真、CLI e2e（汇总行含 top-let 段）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanTopLevelLet } from "../dist/rules/top-level-let.js";

const TOP_LET = "let cached: string | null = null;\nexport function get(): string | null { return cached; }\n";
const NS_LET = "export namespace Loaders {\n  let active: string | null = null;\n  export function get(): string { return active ?? \"\"; }\n}\n";
const FUNC_LET = "export function run(): number {\n  let total = 0;\n  for (let i = 0; i < 3; i++) total += i;\n  return total;\n}\n";
const SLOT = "const slot = { current: undefined as string | undefined };\nexport function get(): string | undefined { return slot.current; }\n";
const EXEMPT = "// nm-style: keep-top-let — JS 互操作要求的模块级可变绑定（理由写在现场）\nlet interop = null;\nexport function read(): unknown { return interop; }\n";

test("T-TL1 模块顶层 let → TOP_LEVEL_LET，blocking 恒真", () => {
  const findings = scanTopLevelLet({ entries: [{ file: "packages/core/src/cache.ts", text: TOP_LET }] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].verdict, "TOP_LEVEL_LET");
  assert.equal(findings[0].rule, "top-level-let");
  assert.equal(findings[0].blocking, true);
  assert.equal(findings[0].line, 1);
  assert.match(findings[0].detail, /cached/);
});

test("T-TL2 namespace 块内顶层 let 同样拦截（R3 收编口径含 namespace 一层）", () => {
  const findings = scanTopLevelLet({ entries: [{ file: "packages/core/src/loaders.ts", text: NS_LET }] });
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /active/);
});

test("T-TL3 函数体内 let / for 循环 let 不在门内（纯局部可变不属 R3）", () => {
  const findings = scanTopLevelLet({ entries: [{ file: "packages/core/src/run.ts", text: FUNC_LET }] });
  assert.equal(findings.length, 0);
});

test("T-TL4 对象槽惯用法（R3 收编形态）不报", () => {
  const findings = scanTopLevelLet({ entries: [{ file: "packages/core/src/slot.ts", text: SLOT }] });
  assert.equal(findings.length, 0);
});

test("T-TL5 keep-top-let 前导注释豁免", () => {
  const findings = scanTopLevelLet({ entries: [{ file: "packages/core/src/interop.ts", text: EXEMPT }] });
  assert.equal(findings.length, 0);
});

test("T-TL6 多个 let 合并单条 finding，names 进 detail；嵌套 namespace 亦拦截", () => {
  const nested = "export namespace A {\n  export namespace B {\n    let deep = 0;\n  }\n}\nlet a = 1, b = 2;\n";
  const findings = scanTopLevelLet({ entries: [{ file: "packages/core/src/multi.ts", text: nested }] });
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /a, b/);
  assert.match(findings[0].detail, /deep/);
});
