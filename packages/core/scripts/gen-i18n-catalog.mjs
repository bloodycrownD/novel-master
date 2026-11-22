/**
 * 从 resources/i18n/*.yaml 生成 src/i18n/generated-catalog.ts（内嵌对象）。
 *
 * 各宿主（desktop main/renderer、mobile、cli）无法在渲染进程/同步路径读盘，
 * 也没有 yaml loader：catalog 以构建期内嵌的 TS 模块进 bundle（spec §2.4 的
 * webview「构建期内嵌」先例推广到全宿主）。YAML 仍是唯一真源；本脚本在
 * catalog 变更后手动重跑，catalog.test.ts 断言生成物与 YAML 同步防漂移。
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { parse } from "yaml";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const catalogDir = join(here, "../resources/i18n");
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

/**
 * i18n 按域拆分：resources/i18n/{error,label,chat,settings}.yaml + resources/i18n/ui/*.yaml。
 * 单文件域 = 文件名承载域层；子目录域（ui/）= 目录名承载域层、locale 子目录承载语言、*.yaml 按语义族物理拆分（生成时合并）。
 * 每文件/子目录文件顶层 zh-CN: / en-US: locale 段、段下保留完整段子树（与旧单文件同构，纯物理拆分）。
 */
const DOMAIN_FILES = ["error", "label", "chat", "settings"];
const DOMAIN_DIRS = ["ui"];
const LOCALES = ["zh-CN", "en-US"];

function loadDomainDoc(domain, path) {
  const doc = parse(readFileSync(path, "utf8")) ?? {};
  const seenLocales = Object.keys(doc);
  if (seenLocales.sort().join(",") !== [...LOCALES].sort().join(",")) {
    throw new Error(`${path} 顶层必须且只能是 ${LOCALES.join(" / ")} locale 段，实际：${seenLocales.join(" / ")}`);
  }
  for (const locale of LOCALES) {
    const segment = doc[locale];
    if (segment == null || typeof segment !== "object" || Array.isArray(segment)) throw new Error(`${path} 缺 ${locale} 段`);
    // locale 段下直接是域内容（域层由文件名/目录名承载，组装时补 ${domain}. 前缀）；同名子层说明双层嵌套，报错。
    if (Object.keys(segment).includes(domain)) {
      throw new Error(`${path} 的 ${locale} 段下不应再嵌套 ${domain}: 层（域层由文件名承载）`);
    }
  }
  return doc;
}

function loadGroups() {
  const flat = { "zh-CN": {}, "en-US": {} };
  for (const domain of DOMAIN_FILES) {
    const doc = loadDomainDoc(domain, join(catalogDir, `${domain}.yaml`));
    for (const locale of LOCALES) Object.assign(flat[locale], flatten(doc[locale], domain, {}));
  }
  for (const domain of DOMAIN_DIRS) {
    // 子目录域：ui/{locale}/*.yaml——目录名承载域层、locale 子目录承载语言，分片按文件名序合并（同段键互斥防静默覆盖）。
    for (const locale of LOCALES) {
      const dir = join(catalogDir, domain, locale);
      const partFiles = readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort();
      if (partFiles.length === 0) throw new Error(`${dir}/ 下没有 .yaml 分片`);
      const merged = {};
      for (const f of partFiles) {
        const segment = parse(readFileSync(join(dir, f), "utf8")) ?? {};
        for (const k of Object.keys(segment)) {
          if (k in merged) throw new Error(`${dir}/${f} 顶层键 ${k} 与其他分片重复`);
          merged[k] = segment[k];
        }
      }
      Object.assign(flat[locale], flatten(merged, domain, {}));
    }
  }
  return flat;
}

const grouped = loadGroups();
const zhCn = grouped["zh-CN"];
const enUs = grouped["en-US"];

/** 按来源文件分拆三个 catalog 组：core（error+label+ui，coreT 装载）、chat、settings（域 translator 各自装载）。 */
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

const domains = splitByDomain(zhCn);
const domainsEn = splitByDomain(enUs);

function literal(obj, indent) {
  const pad = " ".repeat(indent);
  const lines = Object.entries(obj).map(([k, v]) => `${pad}${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  return `{\n${lines.join("\n")}\n${" ".repeat(indent - 2)}}`;
}

function domainBody(keyType, keyImport, zh, en, exportName, moduleId) {
  return `/**
 * 自动生成：scripts/gen-i18n-catalog.mjs 从 resources/i18n/*.yaml 生成，勿手改。
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
