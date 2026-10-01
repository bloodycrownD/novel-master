#!/usr/bin/env node
/**
 * link-hooks · 把 git 的 hooks 路径指向仓内 .githooks/（wave-e H1 Step 2）
 *
 * 挂在根 package.json 的 `prepare` 上，`npm install` 时自动跑一次，
 * 省掉「每个 clone 都要手动 `git config core.hooksPath .githooks`」这一步。
 *
 * 纪律：**永不失败**。tarball / 无 git 目录 / CI 缓存还原等场景下拿不到 git，
 * 此时只 warn 并以 0 退出——`prepare` 失败会让 `npm install`/`npm ci` 整条挂掉，
 * 那是比「钩子没装上」严重得多的故障。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
);
const hooksDir = path.join(repoRoot, ".githooks");

function main() {
  if (!fs.existsSync(path.join(hooksDir, "pre-commit"))) {
    console.warn("[link-hooks] 未找到 .githooks/pre-commit，跳过（仓库可能不完整）。");
    return;
  }
  // POSIX 下 pre-commit 需要可执行位；Windows 无此概念，chmod 失败不影响。
  try {
    fs.chmodSync(path.join(hooksDir, "pre-commit"), 0o755);
  } catch {
    /* 平台不支持可执行位，忽略 */
  }
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: repoRoot });
  console.log("[link-hooks] 已设置 core.hooksPath=.githooks（提交前会跑编码扫描）。");
}

try {
  main();
} catch (error) {
  console.warn(
    `[link-hooks] 未自动配置 git hooks（${error?.message ?? error}）。` +
      `可手动执行：git config core.hooksPath .githooks`,
  );
}