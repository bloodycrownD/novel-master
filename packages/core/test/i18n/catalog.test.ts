/**
 * catalog 校验测试（spec G0.7）：zh-CN 全量、en-US 无多余、占位符对齐、
 * key 正则与域词表、叶子全 string、§2.6 静态书写扫描，外加 tCore 接线冒烟。
 */
import assert from "node:assert/strict";
import {  readFileSync, readdirSync } from "node:fs";
import {  describe, it  } from "node:test";
import {  Catalog  } from "../../src/i18n/catalog.js";
import {  CORE_MESSAGE_KEYS, CORE_MESSAGE_KEY_PATTERN, ERROR_KEY_DOMAINS, LABEL_KEY_DOMAINS, UI_KEY_DOMAINS, type CoreMessageKey  } from "../../src/i18n/keys.js";
import {  tCore  } from "../helpers/core-i18n.js";
import {  CORE_CATALOGS  } from "../../src/i18n/generated-catalog.js";

const CATALOG_DIR = new URL("../../resources/i18n/", import.meta.url);
// i18n 按域拆分：catalog/{error,label,ui,chat,settings}.yaml，文件名 = 组；每文件顶层 locale 段。
import { parse } from "yaml";
const CORE_FILES = ["error", "label", "ui"] as const;
const DOMAIN_FILES = ["error", "label", "chat", "settings"] as const;
const DOMAIN_DIRS = ["ui"] as const;

/** ui/ 子目录分片按文件名序合并为单棵双 locale 树（分片顶层是 zh-CN/en-US 段；同段键互斥防静默覆盖，与 gen-i18n-catalog 的 loadGroups 同款）。 */
function loadUiMerged(): Record<string, Record<string, unknown>> {
    const merged: Record<string, Record<string, unknown>> = {};
    for (const locale of ["zh-CN", "en-US"]) {
        const dir = new URL(`ui/${locale}/`, CATALOG_DIR);
        merged[locale] = {};
        for (const f of readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()) {
            const segment = (parse(readFileSync(new URL(f, dir), "utf8")) ?? {}) as Record<string, unknown>;
            for (const k of Object.keys(segment)) {
                if (k in merged[locale]) throw new Error(`ui/${locale}/${f} 顶层键 ${k} 与其他分片重复`);
                merged[locale][k] = segment[k];
            }
        }
    }
    return merged;
}

function flattenFile(file: string, locale: string): Record<string, string> {
    const out: Record<string, string> = {};
    const doc = file === "ui"
        ? loadUiMerged()
        : (parse(readFileSync(new URL(`${file}.yaml`, CATALOG_DIR), "utf8")) as Record<string, unknown>);
    const segment = doc[locale];
    if (segment == null || typeof segment !== "object") throw new Error(`${file}.yaml 缺 ${locale} 段`);
    const walk = (node: Record<string, unknown>, prefix: string): void => {
        for (const [k, v] of Object.entries(node)) {
            const path = prefix === "" ? k : `${prefix}.${k}`;
            if (v !== null && typeof v === "object") walk(v as Record<string, unknown>, path);
            else out[path] = v as string;
        }
    };
    walk(segment as Record<string, unknown>, file); // 文件名 = 域前缀（与生成器 flatten(segment, domain) 同构）
    return out;
}

function groupBy(files: readonly string[], locale: string): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const file of files) Object.assign(merged, flattenFile(file, locale));
    return merged;
}

const zhCn = groupBy(CORE_FILES, "zh-CN");
const enUs = groupBy(CORE_FILES, "en-US");
const zhCnChat = flattenFile("chat", "zh-CN");
const enUsChat = flattenFile("chat", "en-US");
const zhCnSettings = flattenFile("settings", "zh-CN");
const enUsSettings = flattenFile("settings", "en-US");

function paramsOf(template: string): string[] {
    return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}

import { CHAT_CATALOGS } from "../../src/i18n/generated-chat-catalog.js";
import { SETTINGS_CATALOGS } from "../../src/i18n/generated-settings-catalog.js";

describe("generated catalog（构建期内嵌防漂移）", () => {
    it("CORE_CATALOGS 与 YAML 解析结果逐 key 一致（改 YAML 后须重跑 gen 脚本）", () => {
        assert.deepEqual({...CORE_CATALOGS["zh-CN"]}, {...zhCn});
        assert.deepEqual({...CORE_CATALOGS["en-US"]}, {...enUs});
    });

    it("CHAT_CATALOGS 与 YAML chat 段逐 key 一致（域段并轨后同源）", () => {
        assert.deepEqual({...CHAT_CATALOGS["zh-CN"]}, {...zhCnChat});
        assert.deepEqual({...CHAT_CATALOGS["en-US"]}, {...enUsChat});
    });

    it("SETTINGS_CATALOGS 与 YAML settings 段逐 key 一致（域段并轨后同源）", () => {
        assert.deepEqual({...SETTINGS_CATALOGS["zh-CN"]}, {...zhCnSettings});
        assert.deepEqual({...SETTINGS_CATALOGS["en-US"]}, {...enUsSettings});
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

    it("ui 域 zh 有键 en 必有（第 0 片骨架契约；error/label 允许部分覆盖）", () => {
        for (const key of Object.keys(zhCn)) {
            if (!key.startsWith("ui.")) continue;
            assert.notEqual(enUs[key as CoreMessageKey], undefined, `ui 域 key 缺 en-US 骨架：${key}`);
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
            const domains: readonly string[] = area === "error" ? ERROR_KEY_DOMAINS : area === "label" ? LABEL_KEY_DOMAINS : UI_KEY_DOMAINS;
            assert.ok(domains.includes(domain), `域不在词表内：${key}`);
        }
    });

    it("叶子全 string（parse 层强校验的回归面）", () => {
        for (const value of Object.values(zhCn)) {
            assert.equal(typeof value, "string");
        }
    });

    it("静态书写规范：无 Tab 缩进、无裸陷阱词/数字/布尔、含半角冒号的值必须加引号", () => {
        for (const file of [...DOMAIN_FILES, ...DOMAIN_DIRS]) {
            const source = readFileSync(new URL(file === "ui" ? "ui/zh-CN/transcript.yaml" : `${file}.yaml`, CATALOG_DIR), "utf8");
            assertWritingRules(source, `${file}.yaml`);
        }
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
