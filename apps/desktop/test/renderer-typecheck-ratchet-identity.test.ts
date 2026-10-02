/**
 * CR-F13：renderer 类型棘轮的「错误身份」必须与行号无关。
 *
 * 病症（实测）：身份含 (line,col)，在有 79 条基线错误的文件顶部插一行**注释**（语义上一条
 * 错误都没增没减）⇒ 78 条幻影红（now 371 / baseline 371，总数未变仍判红）。而 `--update`
 * 是无条件的 ⇒ 「插注释 → 幻影红 → 顺手 --update」会把真实新增错误一并洗白。
 *
 * 本用例就是这条 bug 的牙齿：固定两行样例输出喂 parseIdentities，在文件顶部插一行后，
 * 身份集合的大小与内容都必须一模一样；同时钉住「坐标只用于打印定位」这条口径。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseIdentities } from "../scripts/check-renderer-typecheck.mjs";

const SAMPLE = [
  "renderer/features/settings/SettingsViews.tsx(106,20): error TS2345: Argument of type 'string | null' is not assignable to parameter of type 'string'.",
  "renderer/features/settings/SettingsViews.tsx(120,7): error TS2322: Type 'number' is not assignable to type 'string'.",
  "",
].join("\n");

/**
 * 模拟「文件顶部插了一行无关代码」：诊断坐标整体后移 delta 行（这才是 tsc 的真实行为），
 * 同时在输出前面拼上那几行前置内容。
 */
function withInsertedLeadingLine(output: string, deltaLines = 2): string {
  const shifted = output.replace(
    /\((\d+),(\d+)\): error/g,
    (_match, line: string, column: string) =>
      `(${Number(line) + deltaLines},${column}): error`,
  );
  return ["// 无关的一行注释", "/* eslint-disable-next-line */", shifted].join("\n");
}

describe("renderer 类型棘轮身份集合（CR-F13）", () => {
  it("身份不含行列：插入前置行后身份集合完全不变", () => {
    const before = [...parseIdentities(SAMPLE).keys()].sort();
    const after = [...parseIdentities(withInsertedLeadingLine(SAMPLE)).keys()].sort();
    assert.equal(before.length, 2);
    assert.deepEqual(after, before);
  });

  it("身份形如 file: code: message（不含括号坐标）", () => {
    const ids = [...parseIdentities(SAMPLE).keys()];
    for (const id of ids) {
      assert.match(id, /^renderer\/features\/settings\/SettingsViews\.tsx: TS\d+: .+$/);
      assert.doesNotMatch(id, /\(\d+,\d+\)/);
    }
  });

  it("坐标只用于打印定位：行位移后坐标跟着更新", () => {
    const entry = [...parseIdentities(withInsertedLeadingLine(SAMPLE)).values()][0];
    assert.equal(entry.file, "renderer/features/settings/SettingsViews.tsx");
    assert.equal(entry.line, 108); // 106 + 2 行前置
    assert.equal(entry.column, 20);
  });

  it("同文件同 code 同 message 的重复条目按 Set 计一条（口径代价）", () => {
    const duplicated = [
      "renderer/a.tsx(10,3): error TS2322: same message here",
      "renderer/a.tsx(30,9): error TS2322: same message here",
    ].join("\n");
    const ids = new Set(parseIdentities(duplicated).keys());
    assert.equal(ids.size, 1);
  });

  it("真新增错误仍然会被抓住（身份不同 ⇒ 集合变大）", () => {
    const grown = `${SAMPLE}renderer/features/settings/SettingsViews.tsx(200,5): error TS2551: Property 'nope' does not exist on type 'Foo'.`;
    const before = new Set(parseIdentities(SAMPLE).keys());
    const after = new Set(parseIdentities(grown).keys());
    const added = [...after].filter((id) => !before.has(id));
    assert.equal(added.length, 1);
    assert.match(added[0]!, /TS2551/);
  });
});