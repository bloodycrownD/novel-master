/**
 * catalog 校验测试（spec G0.7）：zh-CN 全量、en-US 无多余、占位符对齐、
 * key 正则与域词表、叶子全 string、§2.6 静态书写扫描，外加 tCore 接线冒烟。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseCoreCatalog } from "../../src/i18n/catalog.js";
import { CORE_MESSAGE_KEYS, CORE_MESSAGE_KEY_PATTERN, ERROR_KEY_DOMAINS, LABEL_KEY_DOMAINS, type CoreMessageKey } from "../../src/i18n/keys.js";
import { tCore } from "../helpers/core-i18n.js";
import { CORE_CATALOGS } from "../../src/i18n/generated-catalog.js";

const CATALOG_DIR = new URL("../../src/i18n/catalog/", import.meta.url);
const zhCnSource = readFileSync(new URL("zh-CN.yaml", CATALOG_DIR), "utf8");
const enUsSource = readFileSync(new URL("en-US.yaml", CATALOG_DIR), "utf8");
const zhCn = parseCoreCatalog(zhCnSource);
const enUs = parseCoreCatalog(enUsSource);

function paramsOf(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}

describe("generated catalog（构建期内嵌防漂移）", () => {
  it("CORE_CATALOGS 与 YAML 解析结果逐 key 一致（改 YAML 后须重跑 gen 脚本）", () => {
    assert.deepEqual({...CORE_CATALOGS["zh-CN"]}, {...zhCn});
    assert.deepEqual({...CORE_CATALOGS["en-US"]}, {...enUs});
  });
});

describe("core catalog（G0.7）", () => {
  it("zh-CN 展平后 key 集合 === CORE_MESSAGE_KEYS（100% 覆盖）", () => {
    assert.deepEqual(Object.keys(zhCn).sort(), [...CORE_MESSAGE_KEYS].sort());
  });

  it("en-US 无多余 key（允许部分，缺 key 由回退链落 zh-CN）", () => {
    const known = new Set<string>(CORE_MESSAGE_KEYS);
    for (const key of Object.keys(enUs)) {
      assert.ok(known.has(key), `en-US 出现契约之外的 key：${key}`);
    }
  });

  it("两 locale 同 key 的 {param} 集合一致", () => {
    for (const [key, template] of Object.entries(enUs)) {
      assert.deepEqual(paramsOf(template as string), paramsOf(zhCn[key as CoreMessageKey] as string), `param 集合不一致：${key}`);
    }
  });

  it("每个 key 匹配 keyRule 且域在词表内", () => {
    for (const key of Object.keys(zhCn)) {
      assert.ok(CORE_MESSAGE_KEY_PATTERN.test(key), `key 不匹配 keyRule：${key}`);
      const [area, domain] = key.split(".") as [string, string];
      const domains: readonly string[] = area === "error" ? ERROR_KEY_DOMAINS : LABEL_KEY_DOMAINS;
      assert.ok(domains.includes(domain), `域不在词表内：${key}`);
    }
  });

  it("叶子全 string（parse 层强校验的回归面）", () => {
    for (const value of Object.values(zhCn)) {
      assert.equal(typeof value, "string");
    }
  });

  it("静态书写规范：无 Tab 缩进、无裸陷阱词/数字/布尔、含半角冒号的值必须加引号", () => {
    assertWritingRules(zhCnSource, "zh-CN.yaml");
    assertWritingRules(enUsSource, "en-US.yaml");
  });

  it("tCore 接线：默认 zh-CN、{param} 插值、en-US 覆盖与回退", () => {
    assert.equal(tCore({key: "error.vfs.not_found"}), "文件不存在或已被删除。");
    assert.equal(tCore({key: "label.agent.max_steps", params: {n: 5}}), "最大步数 5");
    assert.equal(tCore({key: "label.agent.max_steps", params: {n: 5}}, "en-US"), "Max steps 5");
    assert.equal(tCore({key: "error.vfs.not_found"}, "en-US"), "File does not exist or has been deleted.");
    assert.equal(tCore({key: "error.chat.attachment_path_blank"}, "en-US"), zhCn["error.chat.attachment_path_blank"]);
    assert.equal(tCore({key: "label.smart_sort.pinned_min"}), "(固定最小,)");
  });
});

const TRAP_LIKE = /^(?:on|off|yes|no|true|false|null|~|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)$/i;

function assertWritingRules(source: string, file: string): void {
  source.split(/\r?\n/).forEach((line, index) => {
    assert.ok(!line.includes("\t"), `${file}:${index + 1} 缩进不得含 Tab`);
    const valuePart = /^\s*[A-Za-z0-9_]+:(.*)$/.exec(line)?.[1]?.trim() ?? "";
    if (valuePart === "" || valuePart.startsWith("\"") || valuePart.startsWith("'")) {
      return;
    }
    const withoutComment = (valuePart.includes(" #") ? valuePart.slice(0, valuePart.indexOf(" #")) : valuePart).trim();
    if (withoutComment === "") {
      return;
    }
    assert.ok(!TRAP_LIKE.test(withoutComment), `${file}:${index + 1} 裸陷阱词/数字/布尔值（必须加引号）：${withoutComment}`);
    assert.ok(!withoutComment.includes(":"), `${file}:${index + 1} 含半角冒号的值未加引号：${withoutComment}`);
  });
}
