/**
 * T-R5 / C4：workplace 改名门禁（工程源码）。
 *
 * 禁止：
 * - `nm:worktree`
 * - `@novel-master/core/worktree`
 * - `worktree_dir_rule`（migration 旧名探测 / legacy fixture / 升级测除外）
 * - GUI（apps）内「工作树」指代本能力
 *
 * 要求仍存在：`workspace`、`$filetree`、`source:"workplace"`（或单引号变体）
 *
 * 用法：`node scripts/check-workplace-rename-gate.mjs`
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const SCAN_ROOTS = ["apps", "packages", "examples", "scripts"];
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".git",
  ".apm",
  "build",
  "android",
  "ios",
]);

const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".md",
  ".html",
]);

/** worktree_dir_rule 允许出现的相对路径（posix）。 */
const WORKTREE_DIR_RULE_ALLOW = [
  "packages/core/src/bootstrap/schema-migrations/rename-worktree-tables-to-workplace-v1.ts",
  "packages/core/test/bootstrap/helpers/legacy-db-fixtures.ts",
  "packages/core/test/bootstrap/schema-migrations.test.ts",
];

/** 文件名含 worktree 时允许的相对路径。 */
const WORKTREE_FILENAME_ALLOW = [
  "packages/core/src/bootstrap/schema-migrations/rename-worktree-tables-to-workplace-v1.ts",
];

/** 门禁定义自身可含探测字符串。 */
const SELF_GATE_FILES = new Set([
  "scripts/check-workplace-rename-gate.mjs",
  "packages/core/test/bootstrap/workplace-rename-gate.test.ts",
]);

/**
 * @param {string} absDir
 * @param {(absFile: string) => void} visit
 */
function walk(absDir, visit) {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".") && ent.name !== ".eslintrc.cjs") {
      if (SKIP_DIR_NAMES.has(ent.name)) continue;
    }
    if (SKIP_DIR_NAMES.has(ent.name)) continue;
    const abs = join(absDir, ent.name);
    if (ent.isDirectory()) {
      walk(abs, visit);
      continue;
    }
    if (!ent.isFile()) continue;
    const dot = ent.name.lastIndexOf(".");
    const ext = dot >= 0 ? ent.name.slice(dot).toLowerCase() : "";
    if (!TEXT_EXT.has(ext)) continue;
    visit(abs);
  }
}

/** @param {string} abs */
function toPosixRel(abs) {
  return relative(ROOT, abs).split(sep).join("/");
}

function main() {
  /** @type {string[]} */
  const violations = [];
  let sawWorkspace = false;
  let sawFiletree = false;
  let sawSourceWorkplace = false;

  for (const rootName of SCAN_ROOTS) {
    const absRoot = join(ROOT, rootName);
    try {
      if (!statSync(absRoot).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(absRoot, (absFile) => {
      const rel = toPosixRel(absFile);
      const base = absFile.split(sep).pop() ?? "";

      if (
        base.toLowerCase().includes("worktree") &&
        !WORKTREE_FILENAME_ALLOW.includes(rel)
      ) {
        violations.push(`${rel}: 文件名仍含 worktree`);
      }

      const text = readFileSync(absFile, "utf8");
      if (text.includes("workspace")) sawWorkspace = true;
      if (text.includes("$filetree")) sawFiletree = true;
      if (
        text.includes('source: "workplace"') ||
        text.includes("source: 'workplace'") ||
        text.includes('source:"workplace"') ||
        text.includes("source:'workplace'")
      ) {
        sawSourceWorkplace = true;
      }

      if (SELF_GATE_FILES.has(rel)) {
        return;
      }

      if (text.includes("nm:worktree")) {
        violations.push(`${rel}: 含 nm:worktree`);
      }
      if (text.includes("@novel-master/core/worktree")) {
        violations.push(`${rel}: 含 @novel-master/core/worktree`);
      }
      if (
        text.includes("worktree_dir_rule") &&
        !WORKTREE_DIR_RULE_ALLOW.includes(rel)
      ) {
        violations.push(`${rel}: 含 worktree_dir_rule（非允许探测/fixture）`);
      }
      if (rel.startsWith("apps/") && text.includes("工作树")) {
        violations.push(`${rel}: GUI 含「工作树」`);
      }
    });
  }

  if (!sawWorkspace) {
    violations.push("门禁期望：工程源仍保留 workspace 标识");
  }
  if (!sawFiletree) {
    violations.push("门禁期望：工程源仍保留 $filetree");
  }
  if (!sawSourceWorkplace) {
    violations.push('门禁期望：工程源仍保留 source:"workplace"');
  }

  if (violations.length > 0) {
    console.error("workplace rename gate FAILED:");
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }

  console.log("workplace rename gate OK");
  console.log("  retained: workspace, $filetree, source:\"workplace\"");
  console.log(
    "  forbidden absent: nm:worktree, @novel-master/core/worktree, worktree_dir_rule (non-allow), GUI 工作树",
  );
}

main();
