/**
 * parseCoreCatalog 单测：含 spec §1.5-3 yaml 探针行为的回归用例
 * （半角冒号裸值、true/123 裸值、on、嵌套、\n 转义）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCoreCatalog } from "../../src/i18n/catalog.js";

describe("parseCoreCatalog", () => {
  it("层级即 key：嵌套展平为 dotted key", () => {
    assert.deepEqual(parseCoreCatalog("error:\n  vfs:\n    not_found: 文件不存在。\n"), {"error.vfs.not_found": "文件不存在。"});
  });

  it("裸 true 被叶子 string 校验拒绝（形似布尔必须加引号）", () => {
    assert.throws(() => parseCoreCatalog("error:\n  vfs:\n    not_found: true\n"), /叶子必须是字符串/);
  });

  it("裸 123 被叶子 string 校验拒绝（形似数字必须加引号）", () => {
    assert.throws(() => parseCoreCatalog("error:\n  vfs:\n    not_found: 123\n"), /叶子必须是字符串/);
  });

  it("裸 on 保持字符串（yaml@2 按 YAML 1.2 core schema 不转布尔；书写规范仍禁裸值，由静态扫描管）", () => {
    assert.deepEqual(parseCoreCatalog("error:\n  vfs:\n    not_found: on\n"), {"error.vfs.not_found": "on"});
  });

  it("值含半角冒号+空格的裸值在 yaml.parse 即报错（必须加引号）", () => {
    assert.throws(() => parseCoreCatalog("error:\n  vfs:\n    not_found: 文件: 不存在\n"));
  });

  it("根是数组 / 空文件 → throw", () => {
    assert.throws(() => parseCoreCatalog("- a\n- b\n"), /根节点必须是对象映射/);
    assert.throws(() => parseCoreCatalog(""), /根节点必须是对象映射/);
  });

  it("中间节点是数组 → throw", () => {
    assert.throws(() => parseCoreCatalog("error:\n  vfs:\n    - a\n"), /中间节点必须是对象映射/);
  });

  it("双引号值内 \\n 是真换行（多行文案约定，不用 YAML 折行）", () => {
    assert.equal(parseCoreCatalog('error:\n  vfs:\n    not_found: "a\\nb"\n')["error.vfs.not_found"], "a\nb");
  });

  it("key 不匹配 keyRule（两段 / 大写段）→ throw", () => {
    assert.throws(() => parseCoreCatalog("error:\n  vfs: 文案\n"), /key 不匹配 keyRule/);
    assert.throws(() => parseCoreCatalog("error:\n  Vfs:\n    not_found: 文案\n"), /key 不匹配 keyRule/);
  });

  it("key 域不在词表内 → throw", () => {
    assert.throws(() => parseCoreCatalog("error:\n  nosuch:\n    not_found: 文案\n"), /域不在词表内/);
    assert.throws(() => parseCoreCatalog("label:\n  nosuch:\n    chip: 文案\n"), /域不在词表内/);
  });
});
