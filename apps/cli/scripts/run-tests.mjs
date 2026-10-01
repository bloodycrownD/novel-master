/**
 * CLI 测试运行器 —— 零收集守卫版（wave-e H6 钩子⑥）。
 *
 * 为什么不用 `tsx --test` + glob 直接写在 package.json 里：
 * node ≥22 的 `--test` 会自己展开 glob（cmd 不展开反而是对的，这一点没问题），
 * **但收集到 0 条时退出码是 0**——传一个拼错的路径就是「`# tests 0` + exit 0」的
 * 假绿，和 N-P0-02（desktop 单引号 + `shell:true` ⇒ Windows 静默空跑）同族。
 * 实测（2026-10-01，本仓）：`npx tsx --test "test/nonexistent-xyz/*.test.ts"` ⇒
 * `# tests 0 / # pass 0 / # fail 0`，退出码 **0**。
 *
 * 本脚本做两件事：
 * ① **收集在 Node 侧自己做**——递归列 `test/` 下全部 `.test.ts`，不经 shell 展开，
 *    顺带消灭「引号语义」这一整类问题；收集数为 0 直接 exit 1，**在起子进程之前**；
 * ② 起子进程后再解析 `# tests N` 复核一次（stdout 收进内存），
 *    N 为 0 或缺失同样 exit 1——防「收集到了文件但 node 一个都没跑」的第二种空跑。
 *
 * 与 desktop `scripts/run-tests.mjs` 同款守卫、同一形态（收集 + `# tests` 复核）；
 * 守卫本体收编在仓内 `scripts/lib/zero-collect-guard.mjs`，两端共用一份，勿再各自复刻。
 * mobile 用 jest，`jest.config.js` 未开 `passWithNoTests` ⇒ 收集 0 条即 exit 1，
 * 自带守卫，**勿重复加**。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNonZeroCollected,
  parseCollectedCount,
} from "../../../scripts/lib/zero-collect-guard.mjs";

const cliRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = path.join(cliRoot, "test");

/** 递归收集 test/ 下的 *.test.ts（排序保证命令行与日志稳定）。 */
function collectTestFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTestFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out.sort();
}

const files = collectTestFiles(testRoot);
if (files.length === 0) {
  console.error(
    `[run-tests] 收集到 0 个测试文件（扫描面：${testRoot} 下递归 *.test.ts）。` +
      `这不是「全绿」，是空跑。`,
  );
  process.exit(1);
}

// 按批 spawn：Windows 命令行有 8191 字符上限，文件多了必须分批（当前 20 个，单批够用）。
// ⚠️ 不用 `npx tsx`：Windows 上 spawn 一个 .cmd 必须 `shell: true`，而 shell 会重新
//    引入「引号语义」这一整类问题——那正是本脚本要消灭的东西。改为直接用当前 node
//    进程去跑 tsx 的 CLI 入口，全程不经 shell。
const tsxCli = path.join(cliRoot, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
const BATCH_SIZE = 60;
for (let i = 0; i < files.length; i += BATCH_SIZE) {
  const batch = files.slice(i, i + BATCH_SIZE);
  // ⚠️ maxBuffer 必须显式放大：spawnSync 默认上限 1 MiB，stdout 超出即**静默截断**
  //    并返回 status=null，被截掉的正是末尾那段 `# tests N`，守卫会误判成「收集 0 条」。
  const result = spawnSync(
    process.execPath,
    [tsxCli, "--test", ...batch],
    {
      cwd: cliRoot,
      stdio: ["inherit", "pipe", "inherit"],
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const stdout = result.stdout ?? "";
  process.stdout.write(stdout);
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  const collected = parseCollectedCount(stdout);
  assertNonZeroCollected({
    collected,
    where: "apps/cli run-tests.mjs",
    details: [`本批文件数 ${batch.length}`, `cwd=${cliRoot}`, `子进程 status=${result.status}`],
  });
}