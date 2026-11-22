#!/usr/bin/env node
/**
 * check-public-ownership · public/ 门面归属守卫（public-surface-ownership spec 步骤 5）
 *
 * 为什么要有这个文件：p21 之前 `public/*.ts` 按便利装符号——tokenizer 的 48 个
 * 符号挂在 provider 门面、`Interrupt`/`Outcome` 经 tokenizer 二级转手、presentation
 * 的 UI 函数塞进 chat——读 `import { X } from "@novel-master/core/format"` 的人
 * 会以为 X 是 format 域的东西，实现却找不到。p22 已按归属收口（116 个跨域
 * re-export 清零），本脚本防止桶子再次按便利塞：public/<域>.ts 的每个 re-export
 * 的来源域必须与门面同名，除非命中下面 EXCEPTIONS 表（带理由）。
 *
 * 检查：
 *   对每个 packages/core/src/public/<name>.ts，提取所有 `export { X } from "<相对路径>"`
 *   （含 `export type` 与内联 `type X` 形态），按路径首段判来源域：
 *     errors / common / presentation / bootstrap → 首段本身
 *     domain/<d> / service/<d> / infra/<d>       → 第二段 d
 *   来源域 ≠ 门面名且不命中 EXCEPTIONS ⇒ 报 MISPLACED。
 *
 * 退出码：0 绿 / 1 红（有任何 MISPLACED）。`--print` 额外列出例外命中明细。
 *
 * 用法：
 *   node scripts/check-public-ownership.mjs
 *   node scripts/check-public-ownership.mjs --print
 *
 * ⚠️ 本脚本只判 re-export 的**归属**，不判消费（消费漏了由 typecheck 暴露）；
 *   也不判「导出了但没人用」（那是 find-fake-exports 的领地）。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(repoRoot, "packages/core/src/public");
const printExceptions = process.argv.includes("--print");

/**
 * 例外表：允许跨域装进门面的条目，每条必须带理由（why）。
 *
 * ⚠️ 这张表是「归属策略」的唯一真源：新增例外时同步改这里并写清 why，
 *   改漏了本脚本会红。`symbols` 缺省 = 该来源域的全部符号都放行；
 *   给了 `symbols` = 只放行列出的符号（更窄，优先用这种）。
 */
const EXCEPTIONS = [
  {
    barrel: "compaction",
    domains: ["domain/depth", "domain/compaction-conditions", "service/compaction-conditions"],
    why: "depth / compaction-conditions 是 compaction 的实现细节，对外语义统一是 compaction",
  },
  {
    barrel: "vfs",
    domains: ["domain/character-card"],
    symbols: ["CHARACTER_CARD_MAX_INPUT_BYTES"],
    why: "角色卡经 VFS 导入，导入上限留在 VFS 门面；其余 character-card 符号不随行（p22 实测外部零消费已撤）",
  },
  {
    barrel: "skills",
    domains: ["bootstrap"],
    symbols: ["BUILTIN_SKILL_NAMES"],
    why: "skills 域概念，bootstrap 只是定义处（定义处 vs 语义域）",
  },
  {
    barrel: "provider",
    domains: ["infra/serialization"],
    why: "zodToJsonSchema 服务于 provider 的 schema 转换，不是独立域",
  },
  {
    barrel: "smart-sort-rule",
    domains: ["domain/workplace"],
    symbols: ["CompiledSmartSortRule"],
    why: "compileSmartSortRule 的返回类型，不能与函数拆开",
  },
  {
    barrel: "chat",
    domains: ["domain/tool"],
    symbols: ["resolveVfsToolFilePath", "VfsToolFilePath"], // p25 裸函数收编后 resolveVfsToolFilePath → VfsToolFilePath.resolve
    why: "VFS 工具卡路径解析，desktop/mobile 的 transcript 消费方都在 chat 门面取，domain/tool 无独立出口（p22 实测有双端消费者，非零消费）",
  },
];

/** 来源路径 → 域标识（与门面名可比）。返回 {kind, domain}：kind 为顶层域或 domain|service|infra。 */
function sourceDomain(rel) {
  const seg = rel.replace(/^\.\.\//, "").split("/");
  if (["errors", "common", "presentation", "bootstrap"].includes(seg[0])) {
    return { kind: seg[0], domain: seg[0], full: seg[0] };
  }
  return { kind: seg[0], domain: seg[1], full: `${seg[0]}/${seg[1]}` };
}

function exceptionHit(barrel, full, symbol) {
  return EXCEPTIONS.find(
    (e) => e.barrel === barrel && e.domains.includes(full) && (!e.symbols || e.symbols.includes(symbol)),
  );
}

const misplaced = [];
const exceptionHits = [];
let totalSymbols = 0;

for (const file of readdirSync(PUBLIC_DIR).filter((f) => f.endsWith(".ts")).sort()) {
  const barrel = file.replace(/\.ts$/, "");
  const src = readFileSync(path.join(PUBLIC_DIR, file), "utf8");
  const re = /export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split("\n").length;
    const { domain, full } = sourceDomain(m[2]);
    for (const raw of m[1].split(",")) {
      const name = raw.replace(/\/\/.*$/, "").trim().replace(/^type\s+/, "");
      if (!name) continue;
      totalSymbols += 1;
      if (domain === barrel) continue;
      const hit = exceptionHit(barrel, full, name);
      if (hit) exceptionHits.push(`${file}:${line} ${name} ← ${m[2]}（例外：${hit.why}）`);
      else misplaced.push(`${file}:${line} MISPLACED ${name} ← ${m[2]}（门面 ${barrel} ≠ 来源域 ${full}）`);
    }
  }
}

if (printExceptions && exceptionHits.length > 0) {
  console.log(`例外命中 ${exceptionHits.length} 条：`);
  exceptionHits.forEach((x) => console.log(`  ${x}`));
}

if (misplaced.length > 0) {
  console.error(`FAIL public 归属检测：${misplaced.length} 个 MISPLACED（共 ${totalSymbols} 个 re-export 符号）`);
  misplaced.forEach((x) => console.error(`  ${x}`));
  console.error("处置：符号移回所属门面（或给来源域加直映 exports），确属跨域语义的在 EXCEPTIONS 表登记并写理由。");
  process.exit(1);
}
console.log(`PASS public 归属检测：${totalSymbols} 个 re-export 符号，跨域 ${exceptionHits.length} 条全部命中例外表。`);
