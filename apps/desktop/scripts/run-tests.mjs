/**
 * Run desktop tests with Node-only native module + Electron stubs loaded first.
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
// 默认目标整体加引号交给 node --test 的递归 glob 展开：execSync 走 /bin/sh
// （无 globstar），`test/**` 只展开一层子目录，顶层 *.test.ts 全部缺席
// （实测仅 7 个子目录文件进入口）。引号阻止 shell 展开，由 node 侧
// `**` 递归匹配顶层与任意深度子目录，三个模式按扩展名互不重叠、无重复。
const testTargets =
  extraArgs.length > 0
    ? extraArgs.join(" ")
    : "'test/**/*.test.ts' 'test/**/*.test.tsx' 'test/**/*.test.js'";

execSync(
  `npx tsx --tsconfig tsconfig.renderer.json --test ${testTargets}`,
  { cwd: desktopRoot, stdio: "inherit", env, shell: true },
);

function mergeNodeOptions(existing, extra) {
  return existing ? `${existing} ${extra}` : extra;
}
