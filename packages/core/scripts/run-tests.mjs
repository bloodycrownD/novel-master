 /**
 * core 测试运行器 —— 零收集守卫版（wave-e H6 钩子⑥ · CR-F12）。
 *
 * 为什么不再用 `bash -O extglob -O globstar -c 'tsx … test/ 递归 !(performance).test.ts'`：
 *  ① bash extglob 在 Windows 上根本没有 bash（cmd/PowerShell），这条命令是**跑不起来**，
 *     不是假绿——但它同时意味着 core 根本没兑现 spec §H6.2 Step 3 承诺的「仓内 Node 脚本
 *     + 守卫」；
 *  ② 更要命的是三条派生脚本（test:msg / test:vfs / test:perf）把 extglob 模式
 *     （`test/message-checkpoint/!(performance).test.ts`）当**参数**透传给 test:fast，
 *     一旦底层不经 shell 展开，它们就收集 0 条 ⇒ 退出码 0 的假绿（N-P0-02 同族）。
 *
 * 本脚本做两件事（形态与 apps/cli/scripts/run-tests.mjs 同款，守卫本体共用
 * scripts/lib/zero-collect-guard.mjs，勿再各自复刻）：
 *  ① **收集在 Node 侧自己做**——fs 递归列 `test/` 下的 `.test.ts`，默认排除
 *     `performance.test.ts`，不经 shell 展开；收集数为 0 直接 exit 1，**在起子进程之前**；
 *  ② 起子进程后逐批解析 `# tests N` 复核，N 为 0 或缺失同样 exit 1——防「收集到了文件
 *     但 node 一个都没跑」的第二种空跑。
 *
 * 用法（派生脚本也走这里，目录 + --exclude 形态，不再有 shell glob）：
 *   node scripts/run-tests.mjs                                     # 全量（等价旧 test）
 *   node scripts/run-tests.mjs --dir test/message-checkpoint --exclude performance.test.ts
 *   node scripts/run-tests.mjs --dir test/vfs
 *   node scripts/run-tests.mjs test/message-checkpoint/performance.test.ts   # 只跑性能那一条
 *
 * 点名的语义：--dir 是「递归扫这个子目录」，裸路径是「目录递归 / 单文件直收」，
 * 两者都**不套默认排除**（点名 performance.test.ts 就跑它）——与旧 test:fast 的透传一致。
 *
 * ⚠️ 分批 spawn：Windows 命令行有上限，文件多了必须分批（452 个文件全量约 27 KB 参数，
 *    单批 120 个约 7 KB，留足增长余量）。全程用当前 node 进程跑 tsx 的 CLI 入口，
 *    **不经 shell**（spawn .cmd 必须 shell:true，而 shell 会把引号语义请回来）。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNonZeroCollected,
  parseCollectedCount,
} from "../../../scripts/lib/zero-collect-guard.mjs";

const coreRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = path.join(coreRoot, "test");

/** 默认排除：性能测试耗时以小时计，日常跑全量时必须排掉（旧 extglob 就是这个意思）。 */
const PERFORMANCE = "performance.test.ts";

function parseArgs(argv) {
  const dirs = [];
  const targets = [];
  const excludes = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dir") dirs.push(argv[++i]);
    else if (arg === "--exclude") excludes.push(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "用法: node scripts/run-tests.mjs [--dir <子目录>] [--exclude <文件名>] [文件/目录...]",
      );
      process.exit(0);
    } else if (arg.startsWith("--")) {
      console.error(`[run-tests] 无法识别的参数：${arg}`);
      process.exit(1);
    } else {
      targets.push(arg);
    }
  }
  return { dirs, targets, excludes };
}

const { dirs, targets, excludes } = parseArgs(process.argv.slice(2));
const explicitExcludes = excludes.slice();
// 口径：只在「什么都没点名、扫全量 test/」时默认排掉 performance.test.ts；
// 一旦调用方点了名（--dir / 裸路径），就按他点名的来。
const scoped = dirs.length > 0 || targets.length > 0;
const effectiveExcludes = explicitExcludes.length > 0 ? explicitExcludes : scoped ? [] : [PERFORMANCE];
const scanRoots = scoped ? dirs.map((rel) => path.join(coreRoot, rel)) : [testRoot];
const explicitFiles = [];

/** 递归收集 *.test.ts（排序保证命令行与日志稳定）。 */
function collectTestFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTestFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out.sort();
}

// 显式点名的目标：目录递归、文件直收；点不存在的路径是响亮失败（不许静默 0 条）。
for (const target of targets) {
  const full = path.resolve(coreRoot, target);
  if (!fs.existsSync(full)) {
    console.error(`[run-tests] 目标不存在：${target}（解析为 ${full}）。`);
    process.exit(1);
  }
  if (fs.statSync(full).isDirectory()) scanRoots.push(full);
  else if (full.endsWith(".test.ts")) explicitFiles.push(full);
  else {
    console.error(`[run-tests] 目标既不是目录也不是 *.test.ts：${target}`);
    process.exit(1);
  }
}

const files = [
  ...(scanRoots.filter((dir) => fs.existsSync(dir)).flatMap((dir) => collectTestFiles(dir))),
  ...explicitFiles,
]
  .filter((file) => !effectiveExcludes.some((name) => path.basename(file) === name))
  .sort();

const scopeNote = [
  scoped ? [...dirs, ...targets].join(", ") : "test（递归）",
  effectiveExcludes.length > 0 ? `排除 ${effectiveExcludes.join(", ")}` : "不排除",
].join(" · ");

if (files.length === 0) {
  console.error(
    `[run-tests] 收集到 0 个测试文件（扫描面：${scopeNote}）。这不是「全绿」，是空跑。`,
  );
  process.exit(1);
}
console.log(`[run-tests] 收集到 ${files.length} 个测试文件（扫描面：${scopeNote}）`);

// 不用 `npx tsx`：Windows 上 spawn 一个 .cmd 必须 shell:true，而 shell 会把「引号语义」
// 这一整类问题请回来——那正是本脚本要消灭的东西。直接用当前 node 进程跑 tsx 的 CLI 入口。
const requireFromCore = createRequire(path.join(coreRoot, "package.json"));
const tsxCli = path.join(
  path.dirname(requireFromCore.resolve("tsx/package.json")),
  "dist",
  "cli.mjs",
);
const BATCH_SIZE = 120;
const MAX_BUFFER = 64 * 1024 * 1024; // spawnSync 默认上限 1 MiB，超出即静默截断（末尾的 `# tests N` 会被切掉）

let totalCollected = 0;
let failedBatches = 0;
let failedBatchIndexes = [];
for (let i = 0; i < files.length; i += BATCH_SIZE) {
  const batch = files.slice(i, i + BATCH_SIZE);
  const batchNo = Math.floor(i / BATCH_SIZE) + 1;
  const result = spawnSync(
    process.execPath,
    [
      tsxCli,
      "--experimental-test-module-mocks",
      "--tsconfig",
      "tsconfig.test.json",
      "--test",
      ...batch,
    ],
    {
      cwd: coreRoot,
      stdio: ["inherit", "pipe", "inherit"],
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
    },
  );
  const stdout = result.stdout ?? "";
  process.stdout.write(stdout);
  // ⚠️ 顺序是硬要求（CR-F11，与 apps/cli / apps/desktop 同款）：`result.error` 判定必须排在
  //    `status` 判定**之前**。截断时 spawnSync 返回 {status: null, error: ENOBUFS}，
  //    `null !== 0` 为真 ⇒ 旧顺序下此处就 exit 了，诊断永远打不出来。
  if (result.error != null) {
    console.error(
      `[run-tests] 子进程异常：${result.error.code ?? result.error.message}；` +
        `stdout 已截断（上限 ${MAX_BUFFER} 字节），以上输出不完整。` +
        `cwd=${coreRoot}；本批（第 ${batchNo} 批）文件数 ${batch.length}。`,
    );
    process.exit(1);
  }
  const collected = parseCollectedCount(stdout);
  // 收集守卫逐批复核：某一批收集 0 条说明这批的 argv 没被 node 接住（假绿），当场 exit 1。
  assertNonZeroCollected({
    collected,
    where: "packages/core run-tests.mjs",
    details: [`第 ${batchNo} 批，文件数 ${batch.length}`, `扫描面 ${scopeNote}`, `cwd=${coreRoot}`],
  });
  totalCollected += collected ?? 0;
  // ⚠️ 测试红了**不**立刻 exit：分批跑的初衷就是绕开 Windows 命令行上限，若第一批红就退，
  //    后面几百个文件一次都跑不到，红的位置会被藏起来。记下来跑完全部再 exit。
  if (result.status !== 0) {
    failedBatches += 1;
    failedBatchIndexes.push(batchNo);
  }
}

console.log(
  `[run-tests] 完成：${files.length} 个文件，共收集 ${totalCollected} 条用例（扫描面：${scopeNote}）`,
);
if (failedBatches > 0) {
  console.error(
    `[run-tests] 有 ${failedBatches}/${Math.ceil(files.length / BATCH_SIZE)} 批测试未全绿` +
      `（第 ${failedBatchIndexes.join(", ")} 批），详见上面各批的 TAP 失败明细。`,
  );
  process.exit(1);
}