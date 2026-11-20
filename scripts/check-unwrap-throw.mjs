#!/usr/bin/env node
/**
 * 门⑦：解包 throw 合法性检查（一律违规判据，2026-11-15 波1-A 收严）。
 *
 * 判据：任何 `throw <expr>.error` 都报违规——所在函数应返回
 * Result<T, AppError>，把 `throw r.error` 改成 `return r`，调用方逐层
 * 接力（strategy.md §二 第一原则「已知的走返回值，未知的走 throw」；
 * spec-2 §2.4「事务外、且该函数应返回 Result/Outcome → 改 return r」）。
 *
 * 不再放行的形态（旧判据已废）：
 *   - 「同函数内有 catch」不放行——catch 只是给异常换了个出口，传播
 *     通道仍是异常，按它放行等于放弃检查；
 *   - IPC handler 的 `try { … if (!r.ok) throw r.error } catch { ipcErr(…) }`
 *     照常计数——它属可辩的边界形态，但统一应写成 toIpcResult 包装器；
 *     是否豁免由编排者裁决，本脚本不给它开后门。
 *
 * 白名单（ALLOW_FILES，五类；新增例外必须先改总纲 §五）：
 *   1. better-sqlite3 事务回滚——`db.transaction(fn)` 只认抛错回滚；
 *   2. packages/core/src/infra/tdbc/ 层；
 *   3. 控制信号转码——DatabaseReplacedError 这类携带状态字段的控制信号
 *     Result 装不下（函数抛错时返回值送不到调用方），从 Result 取出后
 *     rethrow 喂 throw 通道 port（2026-11-16 编排者裁决，
 *     只认指定类，不是任何 Error 都能套）；
 *   4. llm-protocol adapter/parser 出口——`LlmProtocolAdapter.listModels/chat`
 *     port 契约无失败位，ProviderError 按 catch+code 分派 retry（spec-2 §2.1
 *     保留协议）；内部 fetchJson/assertOk/assertSseParseSucceededOrThrow 已
 *     Result 化，出口解包转 throw 喂 transport 的 catch→reject（六期收口裁决）；
 *   5. IntegrityRepairOperation 报告契约——detect/repair「只认报告/异常」，
 *     runAll 捕异常进报告；repo Result 化后实现在读 repo 处解包转 throw
 *     （六期收口裁决，仅 provider-identity-repair.ts，不放行整个目录）。
 */
import fs from "node:fs";
import cp from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// cwd 无关：一律扫本脚本所在仓（scripts/ 的上一级），调用方从任何目录起跑结果一致
// （2026-11-15 修正：从主仓 cwd 调用曾误扫主仓误报红）。
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ALLOW_FILES = [
  // 事务回滚（better-sqlite3 靠抛错回滚，总纲 §五例外 2）
  /transaction-helper\.ts$/,
  // 事务回调（p26 R1 登记，总纲 §五例外 2 的 tdbc 实例）：conn.transaction(fn)
  // 只认抛错回滚——回调内 return 会 commit 半写（message/session service 的
  // fork/copy 与 truncate-tail 现场注释自白）。
  /truncate-tail-in-transaction\.ts$/,
  /^packages\/core\/src\/service\/chat\/impl\/message\.service\.ts$/,
  /^packages\/core\/src\/service\/chat\/impl\/session\.service\.ts$/,
  // tdbc 层
  /^packages\/core\/src\/infra\/tdbc\//,
  // 控制信号转码（2026-11-16 编排者裁决）：DbSyncPort 是 throw 通道 port
  // （port 契约无失败位，「已换库」信号靠 DatabaseReplacedError 异常承载，
  // Result 装不下 databaseReplaced / providerTablesRestored 标志）；本文件的
  // dbSync 适配器把 db-backup 的 Result.err 解包上抛由 coordinator 收口。
  // desktop 同款两处由片2另行登记。
  /^apps\/mobile\/src\/services\/cloud-sync\.service\.ts$/,
  // llm-protocol adapter/parser 出口（2026-11-16 六期收口裁决，总纲 §五 例外 5）：
  // port 契约无失败位，ProviderError 走 throw 通道供 retry 按 catch+code 分派。
  /^packages\/core\/src\/infra\/llm-protocol\/impl\/anthropic\.adapter\.ts$/,
  /^packages\/core\/src\/infra\/llm-protocol\/impl\/gemini\.adapter\.ts$/,
  /^packages\/core\/src\/infra\/llm-protocol\/impl\/openai\.adapter\.ts$/,
  /^packages\/core\/src\/infra\/llm-protocol\/logic\/anthropic-sse-parser\.ts$/,
  /^packages\/core\/src\/infra\/llm-protocol\/logic\/gemini-sse-parser\.ts$/,
  /^packages\/core\/src\/infra\/llm-protocol\/logic\/openai-sse-parser\.ts$/,
  // IntegrityRepairOperation 报告契约（2026-11-16 六期收口裁决，总纲 §五 例外 6）：
  // detect/repair 只认报告/异常，runAll 捕异常进修复报告。
  /provider-identity-repair\.ts$/,
  // p26 R1 边界转码登记（总纲 §五 例外 7，2026-11-20 裁决）——
  // a. runner 前奏终态漏斗与 OrThrow 转码：run 的 throw 喂同函数 catch 的统一
  //    收口（FAILED('') 补发 + onRunFailed），直接 return 会跳过终态事件；
  //    mapResolveError 是 desktop rejection 契约的 OrThrow 边界（十八期 T3 已审）。
  /^packages\/core\/src\/service\/agent\/logic\/run-agent-turn\.ts$/,
  // b. IPC handler 边界：agentRegistry.get 只有 throw 通道，handler catch 转
  //    IpcResult 线格式（同文件判据 2 形态：返回普通类型 + 同函数 catch）。
  /^apps\/desktop\/src\/main\/ipc\/handlers\/agent-registry\.ts$/,
  // c. AgentSession.list port 契约：已知失败抛出交 agent-runner 主 catch 收口
  //    （步进漏斗）；Result 化只会把 unwrap-throw 挪进 agent-runner（同款
  //    raiseRunError 形态已存在），chat-agent-session 与 assemble 是同一契约两端。
  /^packages\/core\/src\/service\/agent\/impl\/chat-agent-session\.ts$/,
  /^packages\/core\/src\/service\/agent\/logic\/assemble-agent-runner-deps\.ts$/,
  // d. 写库边界契约：restore 对外「任意行非法则抛 AppError（DB_BACKUP_*）」，
  //    调用方按 catch 收口（文件 JSDoc 自白）。
  /^packages\/core\/src\/infra\/db-backup\/provider-table-snapshot\.ts$/,
  // e. 校验槽位回调（zod preprocess 同款例外）：DocumentIo 的 assertFileName
  //    槽位契约只认 throw；Result 边界在 CharacterCardDocumentPick/YamlDocumentPick。
  /^apps\/mobile\/src\/services\/vfs-character-card\.service\.ts$/,
  /^apps\/mobile\/src\/services\/yaml-shared\.ts$/,
];

// 文件集 = packages/apps 下一层包的 src/*.ts。不用 `src/**/*.ts` glob——
// git wildmatch 下它不匹配 src 直接子文件（apps/cli/src/main.ts:74/209
// 曾因此漏报），改列全量 tracked 再按路径过滤，口径只宽不窄。
const files = cp
  .execSync("git ls-files packages apps", { encoding: "utf8", cwd: REPO_ROOT })
  .split("\n")
  .filter(Boolean)
  .filter((f) => /^(?:packages|apps)\/[^/]+\/src\/.+\.ts$/.test(f))
  // apps/cli 停止维护（#276）：与 nm-style suppressPrefixes 口径一致，整体排除。
  .filter((f) => !f.startsWith("apps/cli/"))
  .filter((f) => fs.existsSync(path.join(REPO_ROOT, f)) && !ALLOW_FILES.some((re) => re.test(f)));

// `throw x.error;` 与同行 if 形态（`if (!x.ok) throw x.error;`）一并抓取；
// `<expr>` 允许多段成员访问（`throw saved.result.error` 这类也算解包）。
const THROW_RE = /^\s*(?:\}\s*)?(?:if\s*\([^)]*\)\s*)?throw\s+[A-Za-z_$][\w$]*(?:\.[\w$]+)*\.error\s*;/;

const bad = [];
for (const f of files) {
  const lines = fs.readFileSync(path.join(REPO_ROOT, f), "utf8").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!THROW_RE.test(lines[i])) continue;
    bad.push({ f, line: i + 1, text: lines[i].trim() });
  }
}

if (bad.length === 0) {
  console.log("[门⑦] PASS：全仓已无 `throw x.error`（事务回滚与 tdbc 层见白名单）。");
  process.exit(0);
}

// 按目录分布（dirname 聚合，降序）
const byDir = new Map();
for (const b of bad) {
  const dir = path.posix.dirname(b.f);
  byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
}
const dirLines = [...byDir.entries()].sort((a, z) => z[1] - a[1] || a[0].localeCompare(z[0]));

console.log("[门⑦] FIND " + bad.length + " 处 `throw x.error`（判据：一律违规；白名单仅事务回滚 + tdbc + 控制信号转码）：\n");
console.log("—— 按目录分布 ——");
for (const [dir, n] of dirLines) console.log("  " + String(n).padStart(3) + "  " + dir);
console.log("\n—— 明细（前 60 条，共 " + bad.length + " 条）——");
for (const b of bad.slice(0, 60)) console.log("  " + b.f + ":" + b.line + "  " + b.text);
console.log("\n处置：所在函数签名改返回 Result<T, AppError>，`throw r.error` 改 `return r`，调用方逐层接力；例外三类（事务回滚 / tdbc 层 / 控制信号转码，如 DatabaseReplacedError——Result 装不下其状态字段，须 rethrow 喂 throw 通道 port），并在 ALLOW_FILES 登记。");
process.exit(1);
