// Renderer typecheck ratchet (X2 / wave-e).
//
// 病症：`tsconfig.json` 的 include 不含 `renderer/`，vite build 走 esbuild 只转译不查类型
// ⇒ 渲染层长期零类型门禁。本脚本是那道门。
//
// 设计要点（wave-e X2.3 Step 2）：
//   基线存的是「错误身份集合」而不是纯计数。纯计数棘轮有净零绕过漏洞——修掉 1 条、引入 1 条，
//   总数不变 ⇒ 门禁放行，置换型回归从门缝溜过去；而且单靠计数也推不出身份，
//   「打印新增的那几条」无从谈起。身份集合同时解掉两个问题：
//   判红只看集合差集 S \ S0，且不允许置换。
//
//   maxErrors 只作二级上限，仅用于日志与人工 sanity check，不参与判红。
//
// 用法：
//   node scripts/check-renderer-typecheck.mjs           # 门禁：新增错误身份 ⇒ exit 1
//   node scripts/check-renderer-typecheck.mjs --update  # 按当前实跑重写基线（需在 PR 里说明理由）

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const DESKTOP_DIR = resolve(import.meta.dirname, "..");
const BASELINE_PATH = join(DESKTOP_DIR, "typecheck-renderer-baseline.json");
const TSCONFIG = "tsconfig.renderer.json";

/** typescript 可能被提升到仓根 node_modules，用 require 解析而不是猜相对路径。 */
function resolveTscBin() {
  const require = createRequire(join(DESKTOP_DIR, "package.json"));
  return join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
}

/** tsc 错误首行形态：`renderer/x.tsx(106,20): error TS2345: <message 首行>`。 */
const IDENTITY_RE = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s*(.*)$/;

function runTsc() {
  // tsconfig.renderer.json 继承 base 的 composite/incremental；把 tsBuildInfoFile 指到一次性目录，
  // 保证每次都是全量重算，不吃可能陈旧的增量缓存（门禁的判定必须可复现）。
  const scratch = mkdtempSync(join(tmpdir(), "renderer-typecheck-"));
  try {
    const result = spawnSync(
      process.execPath,
      [resolveTscBin(), "--noEmit", "-p", TSCONFIG,
        "--tsBuildInfoFile", join(scratch, "renderer.tsbuildinfo")],
      { cwd: DESKTOP_DIR, encoding: "utf8", shell: false, maxBuffer: 64 * 1024 * 1024 },
    );
    if (result.error) throw result.error;
    if (result.status !== 0 && result.status !== 1 && result.status !== 2) {
      throw new Error(`tsc 以异常状态码 ${result.status} 退出：\n${result.stderr ?? ""}`);
    }
    return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** 把 tsc 输出解析成错误身份集合：{ file, line, column, code, message }。 */
function parseIdentities(output) {
  const identities = new Map();
  for (const raw of output.split(/\r?\n/)) {
    // 续行（overload 展开、属性明细）都是缩进行，不匹配首行形态，天然被跳过。
    const match = IDENTITY_RE.exec(raw);
    if (!match) continue;
    const [, file, line, column, code, message] = match;
    const id = `${file.trim()}(${line},${column}): ${code}: ${message.trim()}`;
    identities.set(id, { file: file.trim(), line: Number(line), column: Number(column), code, message: message.trim() });
  }
  return identities;
}

function loadBaseline() {
  const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  if (!Array.isArray(parsed.known)) throw new Error(`${BASELINE_PATH}: missing "known" array`);
  return parsed;
}

function writeBaseline(ids, { previous }) {
  const body = {
    $comment: [
      "Renderer typecheck ratchet baseline (RULE: count/identity numbers are always measured, never copied from spec).",
      "`known` is the set of tsc error identities (first line of each diagnostic).",
      "The gate turns red on NEW identities (now \\ known) only; `maxErrors` is log/sanity only and never judges.",
      "Lowering the baseline = paying down debt. Raising it = must be justified in the PR.",
    ].join(" "),
    tscConfig: TSCONFIG,
    maxErrors: ids.size,
    previousMaxErrors: previous ?? null,
    known: [...ids].sort(),
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

const output = runTsc();
const current = parseIdentities(output);
const ids = new Set(current.keys());
const baseline = loadBaseline();
const known = new Set(baseline.known);
const added = [...ids].filter((id) => !known.has(id));
const resolved = [...known].filter((id) => !ids.has(id));

// NOTE: gate output is deliberately ASCII-only. The Windows console runs GBK, and a UTF-8
// Chinese message renders as mojibake there -- a gate nobody can read is half a gate.
if (process.argv.includes("--update")) {
  writeBaseline(ids, { previous: baseline.maxErrors });
  console.log(`[renderer-ratchet] baseline rewritten: ${ids.size} entries (added ${added.length}, resolved ${resolved.length}, was ${baseline.maxErrors})`);
  process.exit(0);
}

if (added.length > 0) {
  const byFile = new Map();
  for (const id of added) {
    const entry = current.get(id);
    const bucket = byFile.get(entry.file) ?? [];
    bucket.push(entry);
    byFile.set(entry.file, bucket);
  }
  console.error(`[renderer-ratchet] RED: ${added.length} new error identities (now ${ids.size} / baseline ${known.size})\n`);
  for (const [file, entries] of [...byFile].sort()) {
    console.error(`  ${file}`);
    for (const entry of entries.sort((a, b) => a.line - b.line || a.column - b.column)) {
      console.error(`    (${entry.line},${entry.column}) ${entry.code}: ${entry.message}`);
    }
  }
  console.error("\nFix the errors above, then run `node scripts/check-renderer-typecheck.mjs --update` to lower the baseline.");
  console.error("Raising the baseline to go green is forbidden.");
  process.exit(1);
}

// maxErrors 是一道真天花板：把基线往下调到低于实跑数（哪怕只改 maxErrors、known 数组不动）必红。
// 身份集合负责抓「新增的是哪几条」，maxErrors 负责抓「基线被下调/被做小」——两者缺一不可。
if (ids.size > baseline.maxErrors) {
  console.error(`[renderer-ratchet] RED: maxErrors ceiling is below the measured count (now ${ids.size} > maxErrors ${baseline.maxErrors}).`);
  console.error("The ratchet only ratchets DOWN. Fix errors, then run --update to rewrite the baseline.");
  process.exit(1);
}

console.log(`[renderer-ratchet] GREEN: ${ids.size} / ${known.size} (maxErrors=${baseline.maxErrors}, ceiling enforced)`);
if (resolved.length > 0) {
  console.log(`[renderer-ratchet] hint: ${resolved.length} baseline entries no longer occur; run --update to tighten.`);
}
process.exit(0);
