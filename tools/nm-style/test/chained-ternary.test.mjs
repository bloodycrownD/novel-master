// T-CT1~T-CT9：chained-ternary 规则——链式 / 嵌套正例、独立三元负例、keep-ternary 豁免、
// 同语句多处各报一条、blocking 恒真、从磁盘读取的文件同样生效。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { scanChainedTernary } from "../dist/rules/chained-ternary.js";

const CHAIN = 'export const kind = code === 401 ? "auth" : code === 403 ? "permission" : "server";\n';
const NESTED_TRUE = "export const config = { auth: isOauth ? {type: \"oauth\"} : (hasKey ? {type: \"bearer\"} : {type: \"none\"}) };\n";
const NESTED_CONDITION = "export const label = (ready ? 1 : 0) ? \"on\" : \"off\";\n";
const INDEPENDENT = "export const pair = [a ? x : y, b ? p : q];\n";
const SINGLE = "export const value = ok ? 1 : 0;\n";
const TRIPLE = "export const v = a ? 1 : b ? 2 : c ? 3 : 4;\n";
const JSX = "export const View = () => <Text>{saving ? \"保存中\" : isCreate ? \"新建\" : \"保存\"}</Text>;\n";
const EXEMPT = "// nm-style: keep-ternary — 这里的理由写在现场\nexport const kind = code === 401 ? \"auth\" : code === 403 ? \"permission\" : \"server\";\n";
const TWO_IN_ONE = "export const both = f(a ? x : (b ? y : z), c ? p : (d ? q : r));\n";

const scan = (text) => scanChainedTernary({ entries: [{ file: "packages/core/src/sample.tsx", text }] });

test("T-CT1 链式三元（假分支里再接三元）→ CHAINED_TERNARY，blocking 恒真", () => {
  const findings = scan(CHAIN);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "chained-ternary");
  assert.equal(findings[0].verdict, "CHAINED_TERNARY");
  assert.equal(findings[0].blocking, true);
  assert.equal(findings[0].line, 1);
  assert.match(findings[0].detail, /401/);
});

test("T-CT2 真分支里带括号的嵌套同样命中", () => {
  assert.equal(scan(NESTED_TRUE).length, 1);
});

test("T-CT3 条件位置里嵌的三元不算接续链，不报", () => {
  assert.equal(scan(NESTED_CONDITION).length, 0);
});

test("T-CT4 同一语句里彼此独立的两个三元不报；条件里回调自带的那个也不报", () => {
  assert.equal(scan(INDEPENDENT).length, 0);
  assert.equal(scan("const next = list.some((x) => (x.ok ? x : y)) ? 1 : 0;\n").length, 0);
});

test("T-CT5 单层二选一的三元不报", () => {
  assert.equal(scan(SINGLE).length, 0);
});

test("T-CT6 三段以上的长链只在最外层报一条（不按嵌套层数重复计）", () => {
  assert.equal(scan(TRIPLE).length, 1);
});

test("T-CT7 JSX 子节点里的链式三元同样命中", () => {
  assert.equal(scan(JSX).length, 1);
});

test("T-CT8 keep-ternary 前导注释豁免", () => {
  assert.equal(scan(EXEMPT).length, 0);
});

test("T-CT9 同一语句里两个互不包含的链各报一条；从磁盘读取的文件同样生效", () => {
  assert.equal(scan(TWO_IN_ONE).length, 2);
  const dir = mkdtempSync(path.join(os.tmpdir(), "nm-style-ct-"));
  const file = path.join(dir, "from-disk.ts");
  writeFileSync(file, CHAIN);
  assert.equal(scanChainedTernary({ entries: [{ file, text: null }] }).length, 1);
});
