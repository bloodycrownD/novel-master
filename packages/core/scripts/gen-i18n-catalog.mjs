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

/** 按键前缀分拆三个 catalog 组：core（coreT 装载的 ui/error/label 段）、chat、settings（域 translator 各自装载）。 */
function splitByDomain(flat) {
  const core = {};
  const chat = {};
  const settings = {};
  for (const [k, v] of Object.entries(flat)) {
    if (k.startsWith("chat.")) chat[k] = v;
    else if (k.startsWith("settings.")) settings[k] = v;
    else core[k] = v;
  }
  return { core, chat, settings };
}

const domains = { core: splitByDomain(zhCn).core, chat: splitByDomain(zhCn).chat, settings: splitByDomain(zhCn).settings };
const domainsEn = { core: splitByDomain(enUs).core, chat: splitByDomain(enUs).chat, settings: splitByDomain(enUs).settings };

function literal(obj, indent) {
  const pad = " ".repeat(indent);
  const lines = Object.entries(obj).map(([k, v]) => `${pad}${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  return `{\n${lines.join("\n")}\n${" ".repeat(indent - 2)}}`;
}

function domainBody(keyType, keyImport, zh, en, exportName, moduleId) {
  return `/**
 * 自动生成：scripts/gen-i18n-catalog.mjs 从 src/i18n/catalog/*.yaml 生成，勿手改。
 * 键序固定 zh-CN 在前（localeRule 的对象键序约束：同语言前缀回退依赖键序）。
 * zh-CN 全量（satisfies 即全集断言）；en-US 为部分骨架（缺 key 由回退链落 zh-CN）。
 *
 * @module i18n/${moduleId}
 */

import type { MessageCatalog } from "@/common/i18n.js";
${keyImport}

const ZH_CN: MessageCatalog<${keyType}> = ${literal(zh, 2)} satisfies Record<${keyType}, string>;

const EN_US = ${literal(en, 2)} satisfies Partial<Record<${keyType}, string>>;

/** 各宿主同步建 translator 的内嵌数据（不读盘；YAML 是唯一真源）。as const 保 locale 字面量键，下游 createTranslator 泛型推断不塌。 */
export const ${exportName} = {
  "zh-CN": ZH_CN,
  "en-US": EN_US as MessageCatalog<${keyType}>,
} as const;
`;
}

writeFileSync(outFile, domainBody("CoreMessageKey", 'import type { CoreMessageKey } from "./keys.js";', domains.core, domainsEn.core, "CORE_CATALOGS", "generated-catalog"), "utf8");
writeFileSync(join(here, "../src/i18n/generated-chat-catalog.ts"), domainBody("ChatMessageKey", 'import type { ChatMessageKey } from "@/domain/chat/i18n/keys.js";', domains.chat, domainsEn.chat, "CHAT_CATALOGS", "generated-chat-catalog"), "utf8");
writeFileSync(join(here, "../src/i18n/generated-settings-catalog.ts"), domainBody("SettingsMessageKey", 'import type { SettingsMessageKey } from "@/domain/settings/i18n/keys.js";', domains.settings, domainsEn.settings, "SETTINGS_CATALOGS", "generated-settings-catalog"), "utf8");
console.log("generated: catalog / chat / settings");
console.log(`generated ${outFile} (zh-CN ${Object.keys(zhCn).length} keys, en-US ${Object.keys(enUs).length} keys)`);
