#!/usr/bin/env node
/**
 * SQL mapper XML → generated TS 映射。
 *
 * 从 `resources/sql/*.mapper.xml` 读取 MyBatis 形态的语句定义，展开
 * `<include ref>` 片段引用，产出 `src/infra/sql-template/generated/*.generated.ts`
 * 的 `as const` 模板映射 + 参数名清单。运行时零文件读取（generated 提交进仓，
 * 与 i18n catalog 同一模式）；XML 解析仅构建期使用。
 *
 * 规则：
 * - 语句标签：select / insert / update / delete；片段标签：sql（经 include 展开）。
 * - `<include>` 只支持一层引用，嵌套 include 直接报错（保持生成器轻量）。
 * - 语句 id = repo 方法名（camelCase），生成物键与之一致。
 * - XML 实体（&lt; 等）由解析器反转义，生成物是普通 SQL 文本。
 *
 * 用法：node scripts/gen-sql-mapper.mjs [--check]（--check 只比对不写回，CI 用）。
 *
 * @module scripts/gen-sql-mapper
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

const here = dirname(fileURLToPath(import.meta.url));
const coreRoot = join(here, "..");
const mapperDir = join(coreRoot, "resources/sql");
const outDir = join(coreRoot, "src/infra/sql-template/generated");

/** snake_case namespace → PascalCase + Sql 导出名（chat_message → ChatMessageSql）。 */
function pascalOf(namespace) {
  return namespace.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("") + "Sql";
}

/** SqlTemplateParser 认的动态标签（语句文本内的伪标签，XML 层是结构化元素，需还原为文本形态）。 */
const DYNAMIC_TAGS = new Set(["if", "where", "foreach", "trim", "choose", "when", "otherwise"]);

/** 动态标签节点 → 文本形态（<if test="...">children</if>），属性值按 XML 规则转义。 */
function serializeDynamic(tag, node, fragments, path) {
  const attrs = node[":@"] ?? {};
  const rendered = Object.entries(attrs)
    .map(([key, value]) => ` ${key.replace(/^@_/, "")}="${String(value).replaceAll('"', "&quot;")}"`)
    .join("");
  const inner = textOfNodes(node[tag], fragments, path);
  return `<${tag}${rendered}>${inner}</${tag}>`;
}

/** preserveOrder 子节点序列 → 模板文本（文本节点拼接，include 展开，动态标签还原为文本形态）。 */
function textOfNodes(nodes, fragments, path) {
  let out = "";
  for (const node of nodes) {
    if ("#text" in node) {
      out += node["#text"];
      continue;
    }
    const tag = Object.keys(node).find((key) => key !== ":@");
    if (DYNAMIC_TAGS.has(tag)) {
      out += serializeDynamic(tag, node, fragments, path);
      continue;
    }
    if (tag === "include") {
      const ref = node[":@"]?.["@_ref"];
      if (ref == null) throw new Error(`include 缺少 ref 属性（${path}）`);
      if (out.includes("<include")) throw new Error(`include 嵌套不支持（${path}）`);
      const fragment = fragments.get(ref);
      if (fragment == null) throw new Error(`include ref="${ref}" 不存在（${path}）`);
      out += fragment;
      continue;
    }
    throw new Error(`语句内不允许出现标签 <${tag}>（${path}）——动态标签属于 SqlTemplateParser 层，写在语句文本内即可`);
  }
  return out;
}

/** 模板文本规范化：首尾 trim + 连续 3+ 空行收敛为 1 空行。 */
function normalize(template) {
  const cleaned = template.replace(/\n{3,}/g, "\n\n");
  return cleaned.trim();
}

/** 提取 #{param} 参数名（去重，按出现序）。 */
function paramNamesOf(template) {
  const seen = [];
  for (const match of template.matchAll(/#\{(\w+)\}/g)) {
    if (!seen.includes(match[1])) seen.push(match[1]);
  }
  return seen;
}

const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, trimValues: false, commentPropName: "#comment" });

if (!existsSync(mapperDir)) {
  console.error(`mapper 目录不存在：${mapperDir}`);
  process.exit(1);
}

const mapperFiles = [];
for (const name of ["chat-message.mapper.xml"]) {
  const full = join(mapperDir, name);
  if (existsSync(full)) mapperFiles.push(full);
}
if (mapperFiles.length === 0) {
  console.error(`resources/sql/ 下没有 mapper 文件`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const checkMode = process.argv.includes("--check");
let dirty = 0;

for (const file of mapperFiles) {
  const doc = parser.parse(readFileSync(file, "utf8"));
  const mapperNode = doc.find((node) => "mapper" in node);
  if (mapperNode == null) throw new Error(`${basename(file)} 缺少 <mapper> 根元素`);
  const namespace = mapperNode[":@"]?.["@_namespace"];
  if (namespace == null) throw new Error(`${basename(file)} 的 <mapper> 缺少 namespace`);
  const exportName = pascalOf(namespace);

  const children = mapperNode["mapper"] ?? [];
  const fragments = new Map();
  const statements = [];
  for (const child of children) {
    const tag = Object.keys(child).find((key) => key !== ":@");
    if (tag == null || tag === "#comment" || tag === "#text") continue;
    const id = child[":@"]?.["@_id"];
    if (id == null) throw new Error(`<${tag}> 缺少 id（${namespace}）`);
    if (tag === "sql") {
      fragments.set(id, normalize(textOfNodes(child[tag], fragments, `${namespace}.${id}`)));
      continue;
    }
    if (!["select", "insert", "update", "delete"].includes(tag)) throw new Error(`未知标签 <${tag}>（${namespace}.${id}）`);
    statements.push({ id, text: normalize(textOfNodes(child[tag], fragments, `${namespace}.${id}`)) });
  }
  if (statements.length === 0) throw new Error(`${namespace} 没有任何语句`);

  const seenIds = new Set();
  for (const s of statements) {
    if (seenIds.has(s.id)) throw new Error(`语句 id 重复：${s.id}（${namespace}）`);
    seenIds.add(s.id);
    if (s.text.includes("`") || s.text.includes("${")) throw new Error(`语句 ${s.id} 含模板字面量保留字符（backtick 或 \${）`);
  }

  const lines = [];
  lines.push("/**");
  lines.push(` * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/${basename(file)} 生成，勿手改。`);
  lines.push(` * namespace=${namespace}；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。`);
  lines.push(" *");
  lines.push(" * @module infra/sql-template/generated");
  lines.push(" */");
  lines.push("");
  lines.push(`export const ${exportName} = {`);
  for (const s of statements) {
    lines.push(`    ${s.id}: \``);
    for (const line of s.text.split("\n")) lines.push(`    ${line}`);
    lines.push("    `,");
  }
  lines.push("} as const;");
  lines.push("");
  if (fragments.size > 0) {
    lines.push(`/** <sql id> 片段原样导出（供 base repository 的结构化拼装等非语句消费）。 */`);
    lines.push(`export const ${exportName}Fragments = {`);
    for (const [id, text] of fragments) {
      lines.push(`    ${id}: \``);
      for (const line of text.split("\n")) lines.push(`    ${line}`);
      lines.push("    `,");
    }
    lines.push("} as const;");
    lines.push("");
  }
  lines.push(`/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */`);
  lines.push(`export const ${exportName}Params = {`);
  for (const s of statements) {
    const names = paramNamesOf(s.text);
    lines.push(`    ${s.id}: [${names.map((n) => `"${n}"`).join(", ")}]${names.length === 1 ? "," : ","}`);
  }
  lines.push("} as const;");
  lines.push("");

  const outFile = join(outDir, `${namespace}.mapper.generated.ts`);
  const body = lines.join("\n").replace(/\n    `,\n    /g, "\n    `,\n    ");
  if (checkMode) {
    const current = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";
    if (current !== body) {
      console.error(`生成物过期：${outFile}`);
      dirty += 1;
    }
    continue;
  }
  writeFileSync(outFile, body, "utf8");
  console.log(`generated: ${outFile}（${statements.length} 条语句）`);
}

if (checkMode && dirty > 0) {
  console.error(`共 ${dirty} 个生成物过期——跑 node scripts/gen-sql-mapper.mjs 更新`);
  process.exit(1);
}
console.log("done");
