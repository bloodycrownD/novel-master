#!/usr/bin/env node
/**
 * typecheck-workspaces · 遍历所有 workspace 跑 typecheck，跳过已停止维护的包（门禁脚本）
 *
 * 用途：根 `npm run typecheck` 的唯一入口。`npm run typecheck --workspaces` 会把
 *   `apps/cli` 一起跑进来，而 cli 已停止维护（`docs/Iterations/common-namespace/spec.md` §7：
 *   不迁移、不计入门禁），它的编译红不该阻塞根门禁。npm 的
 *   `--workspace=!@novel-master/cli` 负向过滤实测无效（仍会执行），所以这里显式遍历并跳过。
 *
 * 用法：
 *   node scripts/typecheck-workspaces.mjs
 *
 * 退出码：0 = 所有未跳过的 workspace 通过；1 = 至少一个失败（逐包打印 `error TS` 行）。
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** 已停止维护、不计入门禁的 workspace（仓根相对路径，正斜杠）。 */
const SKIP_WORKSPACES = new Set(["apps/cli"]);
const ERROR_LINES_PER_WORKSPACE = 30;

const rootManifest = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const workspacePatterns = rootManifest.workspaces ?? [];

/** 展开根 package.json 的 workspaces glob（只支持 `dir/*` 与字面路径）。 */
function listWorkspaces() {
  const rels = [];
  for (const pattern of workspacePatterns) {
    if (!pattern.endsWith("/*")) {
      rels.push(pattern);
      continue;
    }
    const group = pattern.slice(0, -2);
    const groupDir = path.join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const name of readdirSync(groupDir)) {
      if (!existsSync(path.join(groupDir, name, "package.json"))) continue;
      rels.push(`${group}/${name}`);
    }
  }
  return rels.filter((rel) => !SKIP_WORKSPACES.has(rel));
}

const targets = listWorkspaces();
const failures = [];

for (const rel of targets) {
  process.stdout.write(`typecheck ${rel} ... `);
  try {
    execSync(`npm run typecheck --if-present -w ${rel}`, { cwd: repoRoot, stdio: "pipe", encoding: "utf8" });
    process.stdout.write("ok\n");
  } catch (error) {
    process.stdout.write("FAIL\n");
    failures.push({ rel, output: `${error.stdout ?? ""}${error.stderr ?? ""}` });
  }
}

if (failures.length > 0) {
  for (const { rel, output } of failures) {
    const lines = output.split(/\r?\n/);
    const tsErrors = lines.filter((line) => line.includes("error TS"));
    const excerpt = tsErrors.length > 0 ? tsErrors.slice(0, ERROR_LINES_PER_WORKSPACE) : lines.slice(-ERROR_LINES_PER_WORKSPACE);
    console.error(`\n=== ${rel} ===\n${excerpt.join("\n")}`);
  }
  console.error(`\ntypecheck FAILED: ${failures.length}/${targets.length} 个 workspace 失败（已跳过 ${[...SKIP_WORKSPACES].join(", ")}）`);
  process.exit(1);
}

console.log(`\ntypecheck PASS: ${targets.length} 个 workspace 全部通过（已跳过 ${[...SKIP_WORKSPACES].join(", ")}）`);
