// T-DI1：keep 指令解析——重点回归旧 bug（箭头函数/函数表达式的注释挂载点取错父节点）。
// fixture 一律就地构造（字符串 → ts.createSourceFile），不写 cwd 文件。
import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { keepDirectiveOf } from "../dist/lib/directives.js";

function parse(code) {
  return ts.createSourceFile("fixture.ts", code, ts.ScriptTarget.Latest, true);
}

function firstNode(sourceFile, predicate) {
  let found;
  const visit = (node) => {
    if (found === undefined && predicate(node)) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

const arrowOf = (sourceFile) => firstNode(sourceFile, (node) => ts.isArrowFunction(node));
const fnDeclOf = (name) => (sourceFile) => firstNode(sourceFile, (node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
const methodOf = (name) => (sourceFile) => firstNode(sourceFile, (node) => ts.isMethodDeclaration(node) && node.name?.text === name);
const propArrowOf = (name) => (sourceFile) => firstNode(sourceFile, (node) => ts.isPropertyAssignment(node) && node.name?.text === name);

test("T-DI1 箭头函数：上一行注释的 keep-local 能取到（旧 bug：挂载点落到 VariableDeclarationList）", () => {
  const source = parse(`
// nm-style: keep-local
export const foo = () => {
  return 1;
};
`);
  assert.equal(keepDirectiveOf(arrowOf(source)), "keep-local");
});

test("T-DI1 箭头函数：行内注释（= 与箭头体之间）的 keep-public 能取到", () => {
  const source = parse("export const foo = /* nm-style: keep-public */ () => 1;\n");
  assert.equal(keepDirectiveOf(arrowOf(source)), "keep-public");
});

test("普通函数声明 / 类方法（JSDoc 与普通注释）/ 对象字面量成员的 keep 指令不回归", () => {
  const fnDecl = parse(`
// nm-style: keep-public
export function bar() {
  return 2;
}
`);
  assert.equal(keepDirectiveOf(fnDeclOf("bar")(fnDecl)), "keep-public");

  const jsdocMethod = parse(`
class A {
  /** nm-style: keep-public */
  m() {
    return 3;
  }
}
`);
  assert.equal(keepDirectiveOf(methodOf("m")(jsdocMethod)), "keep-public");

  const plainMethod = parse(`
class B {
  // nm-style: keep-local
  m() {
    return 4;
  }
}
`);
  assert.equal(keepDirectiveOf(methodOf("m")(plainMethod)), "keep-local");

  const shorthand = parse(`
const obj = {
  // nm-style: keep-local
  m() {
    return 5;
  },
};
`);
  assert.equal(keepDirectiveOf(methodOf("m")(shorthand)), "keep-local");

  const propArrow = parse(`
const obj2 = {
  // nm-style: keep-public
  foo: () => 6,
};
`);
  assert.equal(keepDirectiveOf(propArrowOf("foo")(propArrow)), "keep-public");
});

test("旧别名 public-one-ref 映射 keep-public；keep-bare 可取；无指令返回 undefined 且不认领文件头注释", () => {
  const legacy = parse(`
// nm-style: public-one-ref
export const baz = () => 7;
`);
  assert.equal(keepDirectiveOf(arrowOf(legacy)), "keep-public");

  const bare = parse(`
// nm-style: keep-bare
export function qux() {}
`);
  assert.equal(keepDirectiveOf(fnDeclOf("qux")(bare)), "keep-bare");

  const headered = parse(`
// nm-style: keep-public —— 模块级说明，不属于任何函数
import { x } from "y";
export function outer() {
  const inner = () => 8;
  return inner;
}
`);
  assert.equal(keepDirectiveOf(arrowOf(headered)), undefined);
  assert.equal(keepDirectiveOf(fnDeclOf("outer")(headered)), undefined);
});
