/**
 * 从 src/i18n/catalog/*.yaml 生成 src/i18n/generated-catalog.ts（内嵌对象）。
 *
 * 各宿主（desktop main/renderer、mobile、cli）无法在渲染进程/同步路径读盘，
 * 也没有 yaml loader：catalog 以构建期内嵌的 TS 模块进 bundle（spec §2.4 的
 * webview「构建期内嵌」先例推广到全宿主）。YAML 仍是唯一真源；本脚本在
 * catalog 变更后手动重跑，catalog.test.ts 断言生成物与 YAML 同步防漂移。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const catalogDir = join(here, "../src/i18n/catalog");
const outFile = join(here, "../src/i18n/generated-catalog.ts");

/** 与 parseCoreCatalog 同构的展平：中间节点必须 mapping、叶子必须 string。 */
function flatten(node, prefix, out) {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    throw new Error(`catalog 节点必须为 mapping：${prefix || "(root)"}`);
  }
  for (const [key, value] of Object.entries(node)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, path, out);
    } else if (typeof value === "string") {
      out[path] = value;
    } else {
      throw new Error(`catalog 叶子必须为 string：${path}`);
    }
  }
  return out;
}

function loadLocale(locale) {
  const doc = parse(readFileSync(join(catalogDir, `${locale}.yaml`), "utf8"));
  return flatten(doc ?? {}, "", {});
}

const zhCn = loadLocale("zh-CN");
const enUs = loadLocale("en-US");

function literal(obj, indent) {
  const pad = " ".repeat(indent);
  const lines = Object.entries(obj).map(([k, v]) => `${pad}${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  return `{\n${lines.join("\n")}\n${" ".repeat(indent - 2)}}`;
}

const body = `/**
 * 自动生成：scripts/gen-i18n-catalog.mjs 从 src/i18n/catalog/*.yaml 生成，勿手改。
 * 键序固定 zh-CN 在前（localeRule 的对象键序约束：同语言前缀回退依赖键序）。
 * zh-CN 全量（satisfies 即全集断言）；en-US 为部分骨架（缺 key 由回退链落 zh-CN）。
 *
 * @module i18n/generated-catalog
 */

import type { MessageCatalog } from "@/common/i18n.js";
import type { CoreMessageKey } from "./keys.js";

const ZH_CN: MessageCatalog<CoreMessageKey> = ${literal(zhCn, 2)} satisfies Record<CoreMessageKey, string>;

const EN_US = ${literal(enUs, 2)} satisfies Partial<Record<CoreMessageKey, string>>;

/** 各宿主同步建 translator 的内嵌数据（不读盘；YAML 是唯一真源）。 */
export const CORE_CATALOGS: Readonly<Record<string, MessageCatalog<CoreMessageKey>>> = {
  "zh-CN": ZH_CN,
  "en-US": EN_US as MessageCatalog<CoreMessageKey>,
};
`;

writeFileSync(outFile, body, "utf8");
console.log(`generated ${outFile} (zh-CN ${Object.keys(zhCn).length} keys, en-US ${Object.keys(enUs).length} keys)`);
