/**
 * Run desktop tests with Node-only native module + Electron stubs loaded first.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertNonZeroCollected,
  parseCollectedCount,
} from "../../../scripts/lib/zero-collect-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, "..");
const registerMock = pathToFileURL(
  path.join(desktopRoot, "test", "register-electron-mock.mjs"),
).href;

const env = {
  ...process.env,
  NODE_OPTIONS: mergeNodeOptions(
    process.env.NODE_OPTIONS,
    `--import ${registerMock}`,
  ),
};

const extraArgs = process.argv.slice(2).filter((arg) => arg.length > 0);
// 默认目标整体加双引号交给 node --test 的递归 glob 展开：引号阻止 shell 自己展开
// （Linux 与 Windows 的 shell 引号语义不同，单引号只在 Linux 生效），
// 由 node 侧 `**` 递归匹配顶层与任意深度子目录，三个模式按扩展名互不重叠、无重复。
const testTargets =
  extraArgs.length > 0
    ? extraArgs.join(" ")
    : '"test/**/*.test.ts" "test/**/*.test.tsx" "test/**/*.test.js"';

// stdio: ["inherit", "pipe", "inherit"] —— stderr 继续直通（tsc/tsx 的报错实时可见），
// stdout 收进内存是为了读 tap 汇总行（node --test 在非 TTY 下用 tap reporter）。
// ⚠️ maxBuffer 必须显式放大：spawnSync 的默认上限是 1 MiB，stdout 一旦超出就会
//    **静默截断**并返回 status=null —— 被截掉的正是末尾那段 `# tests N`，
//    守卫于是把「跑过了」误判成「收集 0 条」，报出一句完全误导的错误信息。
//    （实测当时 628 条用例的 stdout = 204,614 字节，距 1 MiB 还有 5× 余量；
//      那是 H6 落地当时的快照数字，套件后来又长了，写大不是嫌小，是不给增长留悬崖。）
const result = spawnSync(
  `npx tsx --tsconfig tsconfig.renderer.json --test ${testTargets}`,
  {
    cwd: desktopRoot,
    stdio: ["inherit", "pipe", "inherit"],
    env,
    shell: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  },
);
process.stdout.write(result.stdout ?? "");
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
// 零收集守卫：node --test 收集 0 条时退出码是 0（N-P0-02 的假绿）。
// 守卫本体在仓内 scripts/lib/zero-collect-guard.mjs，与 apps/cli 共用同一份，
// 本脚本只负责把自己的诊断信息（平台 / glob / 子进程错误码）喂进去。
assertNonZeroCollected({
  collected: parseCollectedCount(result.stdout),
  where: "apps/desktop run-tests.mjs",
  details: [
    `shell=${process.platform}`,
    `testTargets=${testTargets}`,
    `spawnSync error=${result.error?.code ?? "none"}`,
    "N-P0-02 的假绿形态 —— 请检查 glob 与 shell 引号语义。",
  ],
});

function mergeNodeOptions(existing, extra) {
  return existing ? `${existing} ${extra}` : extra;
}
