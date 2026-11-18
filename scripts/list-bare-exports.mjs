#!/usr/bin/env node
/**
 * 裸顶层 export function 盘点（subject-cluster-oop 波 0 检测器）。
 *
 * p23 已把 service 装配工厂收成 XxxFactory object namespace；p24/p25 要把剩余的
 * 裸顶层 `export function` 全部收进主体 namespace。本脚本圈出清单并按域桶汇总，
 * 是后续每个执行分片的地基。`list-subject-clusters.mjs` 复用这里的扫描函数
 * （同一段代码，保证两个脚本与 --gate 的口径完全一致）。
 *
 * 用法：
 *   node scripts/list-bare-exports.mjs <repo> --summary            # 域桶汇总（文件数/函数数，按函数数降序）
 *   node scripts/list-bare-exports.mjs <repo> --bucket core/domain/vfs   # 该桶文件清单
 *   node scripts/list-bare-exports.mjs <repo> --json                # 全量 JSON（供 gate 比对）
 *   node scripts/list-bare-exports.mjs <repo> --summary --include-tests
 *
 * 扫描口径：
 *   - 目录：packages/<包>/src（含 core）、apps/desktop/src、apps/mobile/src
 *   - 排除：dist、node_modules、test/、__tests__（--include-tests 才收）、apps/cli、*.d.ts
 *   - 顶层 `export function` / `export async function`（行首正则匹配，嵌套函数带不了 export 不会误中）
 *   - 豁免：.tsx 中 PascalCase 名（React 组件）、`use` 开头（hooks）、
 *           函数上方 1-3 行注释含 `nm-style: keep-bare`
 *
 * 域桶规则（与 D:/tmp/bare-buckets.py 对拍）：
 *   packages/core/src/<a>/…      a∈{domain,service,infra,presentation} → core/<a>/<b>，否则 core/<a>
 *   apps/mobile/src/<b>/…        → mobile/src/<b>；apps/desktop 同理 → desktop/src/<b>
 *   其他 packages/<包名>/src/…    → packages/<包名>
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const KEEP_BARE_MARK = "nm-style: keep-bare";
const EXPORT_FN = /^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;

function gitLines(command, cwd) {
  try {
    return execSync(command, { cwd, encoding: "utf8", maxBuffer: 1 << 26 }).split("\n").map((f) => f.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** git 已跟踪 + 未跟踪（gate 必须能看到还没 add 的新文件）。 */
export function listSourceFiles(root, { includeTests = false } = {}) {
  return [...gitLines("git ls-files packages apps", root), ...gitLines("git ls-files --others --exclude-standard packages apps", root)]
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .filter((f) => !f.endsWith(".d.ts"))
    .filter((f) => /^packages\/[^/]+\/src\//.test(f) || /^apps\/(desktop|mobile)\/src\//.test(f))
    .filter((f) => {
      const segs = f.split("/");
      if (segs.includes("dist") || segs.includes("node_modules")) return false;
      return includeTests || (!segs.includes("test") && !segs.includes("__tests__"));
    })
    .sort();
}

function bareExportsOf(text, isTsx) {
  const lines = text.split(/\r?\n/);
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const m = EXPORT_FN.exec(lines[i]);
    if (m == null) continue;
    const name = m[1];
    if (isTsx && /^[A-Z]/.test(name)) continue; // .tsx PascalCase = React 组件
    if (/^use[A-Z0-9_]/.test(name) || name === "use") continue; // React hooks
    const above = lines.slice(Math.max(0, i - 3), i).join("\n");
    if (above.includes(KEEP_BARE_MARK)) continue; // nm-style: keep-bare 标注
    if (found.some((fn) => fn.name === name)) continue; // 重载签名只计一次（保留首个行号）
    found.push({ name, line: i + 1 });
  }
  return found;
}

/** 扫描结果：每文件一条，functions 按行序。 */
export function scanBareExports(root, { includeTests = false } = {}) {
  const files = [];
  for (const rel of listSourceFiles(root, { includeTests })) {
    let text;
    try {
      text = readFileSync(join(root, rel), "utf8");
    } catch {
      continue; // 未跟踪又已删除的暂存文件等
    }
    const functions = bareExportsOf(text, rel.endsWith(".tsx"));
    if (functions.length === 0) continue;
    files.push({ file: rel, bucket: bucketOf(rel), functions });
  }
  return files;
}

export function bucketOf(rel) {
  let m = /^packages\/core\/src\/(.+)$/.exec(rel);
  if (m) {
    const seg = m[1].split("/");
    return ["domain", "service", "infra", "presentation"].includes(seg[0]) && seg[1] ? `core/${seg[0]}/${seg[1]}` : `core/${seg[0]}`;
  }
  m = /^apps\/(mobile|desktop)\/(.+)$/.exec(rel);
  if (m) {
    const seg = m[2].split("/");
    return seg[0] === "src" && seg[1] ? `${m[1]}/src/${seg[1]}` : `${m[1]}/${seg[0]}`;
  }
  m = /^packages\/([^/]+)\//.exec(rel);
  return m ? `packages/${m[1]}` : "other";
}

export function summarizeBuckets(files) {
  const buckets = new Map();
  for (const f of files) {
    const b = buckets.get(f.bucket) ?? { files: 0, functions: 0 };
    buckets.set(f.bucket, { files: b.files + 1, functions: b.functions + f.functions.length });
  }
  return buckets;
}

function printSummary(files) {
  const buckets = [...summarizeBuckets(files).entries()].sort((a, b) => b[1].functions - a[1].functions || a[0].localeCompare(b[0]));
  const totalFn = files.reduce((n, f) => n + f.functions.length, 0);
  console.log(`裸顶层 export function：${files.length} 个文件 / ${totalFn} 个函数（按函数数降序）`);
  console.log("");
  console.log(`${"域桶".padEnd(40)} ${"文件".padStart(6)} ${"函数".padStart(6)}`);
  for (const [name, b] of buckets) console.log(`${name.padEnd(40)} ${String(b.files).padStart(6)} ${String(b.functions).padStart(6)}`);
  console.log(`${"TOTAL".padEnd(40)} ${String(files.length).padStart(6)} ${String(totalFn).padStart(6)}`);
}

function printBucket(files, bucket) {
  const hit = files.filter((f) => f.bucket === bucket).sort((a, b) => b.functions.length - a.functions.length || a.file.localeCompare(b.file));
  const totalFn = hit.reduce((n, f) => n + f.functions.length, 0);
  console.log(`桶 ${bucket}：${hit.length} 个文件 / ${totalFn} 个函数（按函数数降序）`);
  if (hit.length === 0) {
    console.log("（该桶没有裸导出，或桶名写错——可用 --summary 查看全部桶名）");
    return;
  }
  for (const f of hit) console.log(`${f.file.padEnd(78)} ${String(f.functions.length).padStart(3)}  ${f.functions.map((fn) => fn.name).join(", ")}`);
}

function runCli() {
  const argv = process.argv.slice(2);
  const root = argv.find((a) => !a.startsWith("--"));
  if (root == null || !(argv.includes("--summary") || argv.includes("--json") || argv.includes("--bucket"))) {
    console.error("用法: node scripts/list-bare-exports.mjs <repo> --summary | --bucket <桶名> | --json [--include-tests]");
    process.exit(2);
  }
  const bucketIdx = argv.indexOf("--bucket");
  const files = scanBareExports(root, { includeTests: argv.includes("--include-tests") });
  if (argv.includes("--json")) {
    const buckets = Object.fromEntries([...summarizeBuckets(files).entries()].sort((a, b) => b[1].functions - a[1].functions).map(([k, v]) => [k, v]));
    console.log(JSON.stringify({ repo: root, includeTests: argv.includes("--include-tests"), totals: { files: files.length, functions: files.reduce((n, f) => n + f.functions.length, 0) }, buckets, files: files.map((f) => ({ file: f.file, bucket: f.bucket, count: f.functions.length, functions: f.functions.map((fn) => fn.name) })) }, null, 2));
    return;
  }
  if (bucketIdx >= 0) printBucket(files, argv[bucketIdx + 1] ?? "");
  else printSummary(files);
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) runCli();
