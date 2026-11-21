// T-NC1~T-NC5：nested-closures——函数内命名闭包的形态识别 / 捕获集分类 / 变异检测 / 嵌套捕获 / keep 豁免。
import assert from "node:assert/strict";
import { test } from "node:test";
import { nestedClosuresOfText } from "../dist/rules/nested-closures.js";

test("T-NC1 形态识别：const 箭头 / function 声明嵌在函数体内才收，顶层与匿名回调不收", () => {
  // 顶层 const 箭头 → 不收（不在函数体内）。
  assert.equal(nestedClosuresOfText("a.ts", "const top = () => 1;").length, 0);
  // 函数体内 const 命名箭头 → 收。
  const inFn = nestedClosuresOfText("a.ts", "export function run(): number { const helper = (): number => 2; return helper(); }");
  assert.equal(inFn.length, 1);
  assert.equal(inFn[0].name, "helper");
  // 匿名内联回调（高阶函数实参）→ 不收。
  assert.equal(nestedClosuresOfText("a.ts", "export function run(): void { [1].map((x) => x + 1); }").length, 0);
  // 嵌套 function 声明 → 收。
  const fnDecl = nestedClosuresOfText("a.ts", "export function run(): void { function inner(): void {} inner(); }");
  assert.equal(fnDecl.length, 1);
  assert.equal(fnDecl[0].name, "inner");
});

test("T-NC2 零捕获 → hoist；捕获外层参数/局部 → parametrize；模块级与 import 不算捕获", () => {
  const hoist = nestedClosuresOfText("a.ts", "export function run(): number { const pure = (x: number): number => x * 2; return pure(3); }");
  assert.equal(hoist[0].suggestion, "hoist");
  const capture = nestedClosuresOfText("a.ts", "export function run(base: number): number { const add = (x: number): number => base + x; return add(1); }");
  assert.equal(capture[0].suggestion, "parametrize");
  assert.deepEqual(capture[0].captures, ["base"]);
  // 外层引用的模块级 const 与 import 名不在捕获集（提升后天然可用）。
  const moduleLevel = nestedClosuresOfText("a.ts", "const LIMIT = 9;\nexport function run(v: number): number { const clamp = (): number => Math.min(v, LIMIT); return clamp(); }");
  assert.deepEqual(moduleLevel[0].captures, ["v"], "模块级 LIMIT 不算捕获");
});

test("T-NC3 捕 this → method 桶；捕获集重绑定 → parametrize-shared", () => {
  const thisOnly = nestedClosuresOfText("a.ts", "class C { run(): number { const get = (): number => this.value; return get(); } value = 1; }");
  assert.equal(thisOnly[0].suggestion, "method");
  assert.equal(thisOnly[0].usesThis, true);
  const mutating = nestedClosuresOfText("a.ts", "export function run(): number { let total = 0; const bump = (): void => { total += 1; }; bump(); return total; }");
  assert.equal(mutating[0].suggestion, "parametrize-shared");
  assert.deepEqual(mutating[0].mutated, ["total"], "捕获名被重绑定/变异要单列");
});

test("T-NC4 嵌套双层：内层捕获外层的局部与外层的局部都入捕获集，外层名不误报", () => {
  const src = [
    "export function outer(): number {",
    "  const shared = 1;",
    "  function middle(): number {",
    "    const local = 2;",
    "    const inner = (): number => shared + local;",
    "    return inner();",
    "  }",
    "  return middle();",
    "}",
  ].join("\n");
  const found = nestedClosuresOfText("a.ts", src);
  const inner = found.find((f) => f.name === "inner");
  assert.ok(inner != null, "内层闭包应被收集");
  assert.deepEqual(inner.captures.sort(), ["local", "shared"], "隔层捕获与紧邻捕获都算");
});

test("T-NC5 keep 豁免：nm-style: keep-closure 前导注释跳过", () => {
  const src = [
    "export function run(): number {",
    "  // nm-style: keep-closure — 闭包语义即接口。",
    "  const keeper = (): number => 42;",
    "  return keeper();",
    "}",
  ].join("\n");
  assert.equal(nestedClosuresOfText("a.ts", src).length, 0);
});
