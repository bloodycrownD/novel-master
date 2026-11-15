#!/usr/bin/env node
/**
 * 门⑦：解包 throw 的合法性检查。
 *
 * 判据（spec-2 §2.4 + 总纲 §二）：
 *   一个 `throw someResult.error` / `throw someResult` 只在一处合法——
 *   同函数内有 catch 把它接住，即「把 Result 汇入统一出口」。
 *
 *   判定顺序（2026-11-15 编排者裁决修正）：
 *   1. 同函数内有 catch → 合法：把 Result 汇入统一出口的边界转码（与返回类型
 *      无关——IpcResult handler 的 try 内 throw 即此形态）。
 *   2. 无 catch 且所在函数返回 Result<T,E> / Outcome<T>（IpcResult 线格式不算
 *      通道）→ A 类：应 `return r`，不该 throw。
 *   3. 无 catch 且不返回上述通道 → B 类：该 throw 会一路冒出，等于又拿异常
 *      做跨层传播，改返回 Result 或补 catch。
 *
 * 白名单：事务回调（better-sqlite3 靠抛错回滚）与平台边界见 spec-2 §2.3。
 */
import fs from "node:fs";
import cp from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// cwd 无关：一律扫本脚本所在仓（scripts/ 的上一级），调用方从任何目录起跑结果一致
// （2026-11-15 修正：从主仓 cwd 调用曾误扫主仓误报红）。
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ALLOW_FILES = [
  // 事务回调（better-sqlite3 靠抛错回滚，总纲 §五例外 2）
  /transaction-helper\.ts$/,
  /^packages\/core\/src\/infra\/tdbc\//,
  // —— 三期解包清算白名单（波 5a-4：apps/mobile + packages/core；desktop/cli 归对应波）——
  // 白名单纪律：文件内解包 throw 处必须有「解包 throw 边界」注释写明调用链收口点。
  // mobile 端：core Result → 端内异常通道转码边界（mobile service/UI 统一异常口径，
  // UI 事件 catch → formatError → toast）。
  /^apps\/mobile\/src\/services\/user-vfs-turn-execute\.service\.ts$/,
  /^apps\/mobile\/src\/services\/session-prompt-input\.service\.ts$/,
  /^apps\/mobile\/src\/services\/cloud-sync-config\.store\.ts$/,
  /^apps\/mobile\/src\/storage\/app-ui-prefs\.ts$/,
  // core：调用方紧邻 catch（bootstrap try/catch）或框架级统一收口（tool-runner /
  // agent turn loop / chip 读口），及 KKV Result → service 异常通道的适配 helper。
  /^packages\/core\/src\/bootstrap\/skills\/seed-builtin-skills\.ts$/,
  /^packages\/core\/src\/domain\/chat\/logic\/prompt\/prompt-assembler\.ts$/,
  /^packages\/core\/src\/service\/prompt\/render-prompt\.ts$/,
  /^packages\/core\/src\/domain\/tool\/builtin\/subagent-tool\.ts$/,
  /^packages\/core\/src\/domain\/tool\/builtin\/search\/search-config\.ts$/,
  /^packages\/core\/src\/domain\/provider\/repositories\/impl\/kkv-model-suggestion\.repository\.ts$/,
  /^packages\/core\/src\/service\/compaction-conditions\/impl\/compaction-conditions-store\.service\.ts$/,
  /^packages\/core\/src\/service\/persistent-preferences\/impl\/persistent-preferences\.service\.ts$/,
  /^packages\/core\/src\/service\/persistent-state\/impl\/persistent-state\.service\.ts$/,
  /^packages\/core\/src\/service\/provider\/impl\/model-retry-policy\.service\.ts$/,
  // —— 三期解包清算白名单（波 5a-3：apps/desktop；调用链收口点注释在各解包 throw 处）——
  // desktop 端：core Result → main 进程异常通道转码边界（IPC handler try/catch →
  // formatIpcError → IpcResult 线格式；读口哨兵 → catch → null/fallback）。
  /^apps\/desktop\/src\/main\/services\/user-vfs-turn-execute\.service\.ts$/,
  /^apps\/desktop\/src\/main\/services\/session-prompt-input\.service\.ts$/,
  /^apps\/desktop\/src\/main\/services\/cloud-sync-config\.store\.ts$/,
  /^apps\/desktop\/src\/main\/services\/chat-prompt-tokens\.service\.ts$/,
  /^apps\/desktop\/src\/main\/services\/prompt-preview\.service\.ts$/,
  /^apps\/desktop\/src\/main\/services\/vfs-operations\.service\.ts$/,
  // —— 三期门⑦收敛收尾（跨波残留清算，2026-11-15）：四路并行各自只白名单了本路
  // 触碰的文件，以下是无人认领的跨波文件，口径与前几批一致（nm-code-style §3：
  // 边界统一 throw），边界注释已补在各文件解包 throw 处。
  // cli 端：core Result → CLI 异常通道转码边界（main.ts 两个边界 catch →
  // exitCodeForError + formatCliError → exit code）。
  /^apps\/cli\/src\/agent\/commands\.ts$/,
  /^apps\/cli\/src\/agent\/registry-commands\.ts$/,
  /^apps\/cli\/src\/config\/resolve-provider-scope\.ts$/,
  /^apps\/cli\/src\/message\/commands\.ts$/,
  /^apps\/cli\/src\/model\/commands\.ts$/,
  /^apps\/cli\/src\/provider\/model\/commands\.ts$/,
  /^apps\/cli\/src\/provider\/model\/sampling-commands\.ts$/,
  // mobile 端漏网镜像：desktop 同名文件已在波 5a-3 白名单，本文件是其双端镜像
  // （renameVfsFile → VfsFileManager 事件 catch → formatError → toast）。
  /^apps\/mobile\/src\/services\/vfs-operations\.service\.ts$/,
  // core 端跨波残留：normalizePath / 解码 / parse `Result` → 领域异常通道转码点
  // （调用链端点 handler / 屏幕 / CLI catch 收口），及两处既有裁决保留的边界抛出
  // （fork-copy-seeder「仓储异常按边界抛出」、ensure-directory-chain「按旧实现
  // 抛错不扩宽错误联合」，裁决注释原在文件内）。
  /^packages\/core\/src\/domain\/chat\/logic\/attachment\/prompt-path-seen\.ts$/,
  /^packages\/core\/src\/domain\/chat\/logic\/fork-copy-seeder\.ts$/,
  /^packages\/core\/src\/domain\/message-checkpoint\/logic\/ensure-directory-chain\.ts$/,
  /^packages\/core\/src\/domain\/provider\/repositories\/impl\/sqlite-saved-model\.repository\.ts$/,
  /^packages\/core\/src\/domain\/skills\/logic\/skill-paths\.ts$/,
  /^packages\/core\/src\/domain\/tool\/builtin\/vfs-tools\.ts$/,
  /^packages\/core\/src\/domain\/tool\/logic\/fs-command\.ts$/,
  /^packages\/core\/src\/domain\/vfs\/content-store\/impl\/sqlite-vfs-content-store\.ts$/,
  /^packages\/core\/src\/domain\/vfs\/logic\/parent-dir\.ts$/,
  /^packages\/core\/src\/domain\/vfs\/logic\/vfs-zip-path\.ts$/,
  /^packages\/core\/src\/domain\/vfs\/repositories\/impl\/sqlite-vfs-entry\.repository\.ts$/,
  /^packages\/core\/src\/domain\/vfs\/repositories\/impl\/sqlite-vfs-revision\.repository\.ts$/,
  /^packages\/core\/src\/domain\/workplace\/logic\/workplace-file-tree\.ts$/,
  /^packages\/core\/src\/domain\/workplace\/logic\/workplace-path-map\.ts$/,
  /^packages\/core\/src\/domain\/workplace\/logic\/workplace-tree\.ts$/,
  /^packages\/core\/src\/domain\/workplace\/repositories\/impl\/sqlite-workplace\.repository\.ts$/,
  /^packages\/core\/src\/service\/chat\/impl\/message\.service\.ts$/,
  /^packages\/core\/src\/service\/chat\/impl\/session\.service\.ts$/,
  /^packages\/core\/src\/service\/smart-sort-rule\/impl\/smart-sort-rule\.service\.ts$/,
  /^packages\/core\/src\/service\/vfs\/impl\/character-card-import\.service\.ts$/,
  /^packages\/core\/src\/service\/vfs\/logic\/ensure-import-dir-rules\.ts$/,
  /^packages\/core\/src\/service\/workplace\/impl\/workplace\.service\.ts$/,
  // —— 三期门⑦收敛收尾·第二批（worktree 实测清单，2026-11-15）：四路并行后
  // 无人认领的 VFS service 层 / agent 链 / cli 命令 / mobile 端文件，口径同上批。
  // core VFS service：路径/名称校验与写入 `Result` → 领域异常通道转码点（nm-code-style
  // §3 的 service 边界 throw），经 apps 至端点（handler / 屏幕 / CLI）catch 收口。
  /^packages\/core\/src\/service\/vfs\/impl\/physical-vfs\.service\.ts$/,
  /^packages\/core\/src\/service\/vfs\/impl\/revision-aware-vfs\.service\.ts$/,
  /^packages\/core\/src\/service\/vfs\/impl\/scoped-vfs\.service\.ts$/,
  /^packages\/core\/src\/service\/vfs\/impl\/vfs-batch-io\.service\.ts$/,
  /^packages\/core\/src\/service\/vfs\/impl\/vfs-zip-io\.service\.ts$/,
  /^packages\/core\/src\/service\/vfs\/impl\/vfs\.service\.ts$/,
  // core agent 链：仓储/runtime `Result` → agent 会话与 run 异常通道转码点，
  // 由 agent turn loop 框架级统一收口；skill-tool 闭包由 tool-runner 收口。
  /^packages\/core\/src\/domain\/tool\/builtin\/skill-tool\.ts$/,
  /^packages\/core\/src\/service\/agent\/impl\/chat-agent-session\.ts$/,
  /^packages\/core\/src\/service\/agent\/logic\/agent-run-shared\.ts$/,
  // cli 命令与实体解析：repo/runtime `Result` → CLI 异常通道转码边界
  // （main.ts 两个边界 catch → exitCodeForError + formatCliError）。
  /^apps\/cli\/src\/config\/resolve-entity\.ts$/,
  /^apps\/cli\/src\/project\/commands\.ts$/,
  /^apps\/cli\/src\/session\/commands\.ts$/,
  /^apps\/cli\/src\/sort-rule\/commands\.ts$/,
  // mobile 端：runtime/storage `Result` → 端内异常通道转码边界（UI 事件 /
  // 屏幕调用链 catch → formatError → toast）；prompt-preview 为 desktop 同名
  // 白名单文件的双端镜像。
  /^apps\/mobile\/src\/runtime\/mobile-scope\.ts$/,
  /^apps\/mobile\/src\/services\/agent-picker\.ts$/,
  /^apps\/mobile\/src\/services\/prompt-preview\.service\.ts$/,
  /^apps\/mobile\/src\/storage\/chat-composer-draft\.ts$/,
];
const files = cp
  .execSync('git ls-files "packages/*/src/**/*.ts" "apps/*/src/**/*.ts"', { encoding: "utf8", cwd: REPO_ROOT })
  .split("\n")
  .filter(Boolean)
  .filter((f) => fs.existsSync(path.join(REPO_ROOT, f)) && !ALLOW_FILES.some((re) => re.test(f)));

const FN_START = /^\s*(?:export\s+)?(?:async\s+)?function\s+\w+|^\s*(?:export\s+)?const\s+\w+\s*=\s*(?:async\s*)?\(|^\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?=>|^\s*(?:public|private|protected)?\s*(?:async\s+)?\w+\s*\([^)]*\)\s*:\s*/;

// throw 可能与 `if (...)` 同行（`if (!x.ok) throw x.error;`），一并抓取
const THROW_RE = /^\s*(?:\}\s*)?(?:if\s*\([^)]*\)\s*)?throw\s+([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*(?:\.error\s*)?;/;

/** 括号平衡预扫：每个 FN_START 行到其函数体闭合行的区间（短函数不再吸走归属） */
function fnRanges(lines) {
  const ranges = [];
  let depth = 0;
  let pendingDepth = -1;
  let pendingStart = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (pendingStart < 0 && FN_START.test(line)) {
      pendingDepth = depth;
      pendingStart = i;
    }
    for (const ch of line) {
      if (ch === "{" || ch === "(") depth += 1;
      else if (ch === "}" || ch === ")") depth -= 1;
    }
    if (pendingStart >= 0 && i > pendingStart && depth <= pendingDepth) {
      ranges.push({ start: pendingStart, end: i });
      pendingStart = -1;
    }
  }
  if (pendingStart >= 0) ranges.push({ start: pendingStart, end: lines.length - 1 });
  return ranges;
}

/** 从行 i 向上找所属函数的签名区间（返回起始行号），找不到返回 -1 */
function findEnclosingFn(ranges, i) {
  for (let j = ranges.length - 1; j >= 0; j -= 1) {
    if (ranges[j].start <= i && i <= ranges[j].end) return ranges[j].start;
  }
  return -1;
}

/** 函数体内是否有 catch */
function hasCatchInFn(lines, start, end) {
  for (let j = start; j < Math.min(end + 1, lines.length); j += 1) {
    if (/\bcatch\s*\(/.test(lines[j]) || /\bcatch\s*\{/.test(lines[j])) return true;
  }
  return false;
}

const bad = [];
for (const f of files) {
  const lines = fs.readFileSync(path.join(REPO_ROOT, f), "utf8").split("\n");
  const ranges = fnRanges(lines);
  for (let i = 0; i < lines.length; i += 1) {
    const m = THROW_RE.exec(lines[i]);
    if (!m) continue;
    const target = m[1];
    // 只关心「抛 Result/Outcome 的解包」，即形如 x.error 或已知 Result 变量名
    const isUnwrap = /\.error$/.test(lines[i].slice(0, lines[i].indexOf(";"))) || /^(r|res|result|outcome|saved|parsed|exists|listed|layout|validation|materialized)$/.test(target);
    if (!isUnwrap) continue;
    const fnStart = findEnclosingFn(ranges, i);
    if (fnStart < 0) continue;
    const sig = lines.slice(fnStart, fnStart + 4).join(" ");
    const fnEnd = ranges.find((r) => r.start === fnStart)?.end ?? lines.length - 1;
    // 先判 catch：同函数内有 catch 一律放行（边界转码，唯一合法位置）
    const hasCatch = hasCatchInFn(lines, fnStart, fnEnd);
    if (hasCatch) continue;
    // IpcResult 是 IPC 线格式 DTO（spec-3 §3.1），不是 Result 通道，先排除再匹配
    const returnsChannel = !/IpcResult/.test(sig) && /:\s*(?:Promise<)?(?:Result|Outcome)</.test(sig);
    if (returnsChannel) {
      bad.push({ kind: "A 该 return 却 throw", f, line: i + 1, text: lines[i].trim(), sig: sig.trim().slice(0, 110) });
    } else {
      bad.push({ kind: "B 跨层抛出无 catch", f, line: i + 1, text: lines[i].trim(), sig: sig.trim().slice(0, 110) });
    }
  }
}

if (bad.length === 0) {
  console.log("[门⑦] PASS：解包 throw 全部落在「同函数有 catch」的边界位置或事务/平台白名单内。");
  process.exit(0);
}
console.log("[门⑦] FIND " + bad.length + " 处解包 throw 待处理：\n");
for (const b of bad) console.log("  [" + b.kind + "] " + b.f + ":" + b.line + "  " + b.text + "\n      所属函数签名：" + b.sig);
console.log("\n处置：返回 Result/Outcome 的函数改成 `return r`；不返回的改成返回 Result，或确认它是边界并补 catch。");
process.exit(1);
