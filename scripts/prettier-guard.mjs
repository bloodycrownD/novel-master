#!/usr/bin/env node
/**
 * prettier 护栏：挡住会把 check-signatures 从 0 打成上百处的「全仓 write」。
 *
 * 背景：nm-code-style §2 要求函数签名 / 调用参数 / new 构造 / 短 import / 简单右值都写一行，
 * prettier 按 printWidth 拆行，两者直接冲突。六期实测：对全仓跑
 * `npx prettier --write --print-width 200` 后，check-signatures 从 0 反弹到 148 处，
 * 只能 `git restore .` 回滚；printWidth 调到 200 也挡不住。
 *
 * 用法：
 *   node scripts/prettier-guard.mjs -- --write --print-width 200 <单个文件或单包目录>
 *   node scripts/prettier-guard.mjs -- --check --print-width 200 <任意只读范围>
 *
 * 规则：
 *   - 只读形态（--check，或不带 --write）直接放行；
 *   - --write 必须显式给 --print-width（prettier 默认 80，几乎必然拆行）；
 *   - --write 拒绝跨包 / 全仓目标（packages/*、apps/**、仓库根 .、*、** 等），
 *     因为一次重排会产生大量 check-signatures 新发现，回滚成本高。
 *
 * 正确定位：先跑 check-signatures，确认目标文件本来就有 0 处发现；只对这些文件单独跑 prettier。
 * 详见 scripts/README.md「prettier guard」一节。
 *
 * 退出码：0 通过（含 prettier 自身成功）；1 prettier 子进程失败；2 用法错误 / 护栏拒绝。
 */
import { spawn } from "node:child_process";

const USAGE = `用法：node scripts/prettier-guard.mjs -- <prettier 参数...>

正确用法（只对 check-signatures 无发现的文件单独跑）：
  node .agents/skills/nm-code-style/scripts/check-signatures.mjs <file>   # 先确认 0 处
  node scripts/prettier-guard.mjs -- --write --print-width 200 <file-or-dir>

只读检查可跑任意范围（包括全仓）：
  node scripts/prettier-guard.mjs -- --check --print-width 200 packages/core/src
`;

function refuse(reason) {
  console.error(`prettier-guard: 拒绝执行——${reason}`);
  console.error("");
  console.error(USAGE);
  process.exit(2);
}

const raw = process.argv.slice(2);
const separator = raw.indexOf("--");
if (separator < 0) refuse("缺少参数分隔符 --（guard 只接管 -- 之后的参数）");
const args = raw.slice(separator + 1);
if (args.length === 0) refuse("-- 之后没有任何 prettier 参数");

const isWrite = args.some((arg) => arg === "--write" || arg === "-w");
if (isWrite) {
  const widthArg = args.find((arg) => arg === "--print-width" || arg.startsWith("--print-width="));
  const widthValue = widthArg == null ? null : widthArg === "--print-width" ? args[args.indexOf(widthArg) + 1] : widthArg.slice("--print-width=".length);
  if (widthValue == null || widthValue.startsWith("--")) refuse("--write 必须显式给 --print-width（例如 --print-width 200）；prettier 默认 80，必然把签名和调用拆行");
  if (!/^\d+$/.test(widthValue)) refuse(`--print-width 的值无效：${widthValue}`);
  if (Number(widthValue) < 200) console.error(`prettier-guard: 警告——--print-width ${widthValue} 低于 200，拆行风险更高；check-signatures 的干净状态可能保不住`);

  const ROOT_WIDE = new Set([".", "./", "*", "**", "**/*", "packages", "apps", "packages/", "apps/"]);
  const isWideTarget = (arg) => {
    const path = arg
      .replace(/^["']|["']$/g, "")
      .replace(/\\/g, "/")
      .replace(/^\.\//, "");
    if (path === "" || ROOT_WIDE.has(path) || path.startsWith("*") || path.startsWith("{")) return true;
    return /(?:^|\/)(?:packages|apps)\/[^/]*[*{][^/]*(?:\/|$)/.test(path);
  };
  const wide = args.filter(isWideTarget);
  if (wide.length > 0) refuse(`--write 拒绝跨包 / 全仓目标：${wide.join(", ")}；只对 check-signatures 无发现的单个文件（最多单包目录）跑`);
}

console.log(`prettier-guard: 放行 → npx prettier ${args.join(" ")}`);
const child = spawn("npx", ["prettier", ...args], { stdio: "inherit", shell: process.platform === "win32" });
child.on("error", (error) => {
  console.error(`prettier-guard: 启动 prettier 失败——${error.message}`);
  process.exit(2);
});
child.on("close", (code, signal) => {
  if (signal != null) {
    console.error(`prettier-guard: prettier 被信号 ${signal} 终止`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
