/**
 * Keep a Node-ABI copy of better-sqlite3 for desktop tests, separate from the
 * Electron binary under node_modules/better-sqlite3 (avoids EBUSY / ABI fights).
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, "..");
const repoRoot = path.join(desktopRoot, "..", "..");
const sourceDir = path.join(repoRoot, "node_modules", "better-sqlite3");
const testNativeRoot = path.join(desktopRoot, ".test-native");
const copyDir = path.join(testNativeRoot, "better-sqlite3");

function sqliteCopyWorks() {
  try {
    const sqlitePath = copyDir.split(path.sep).join("/");
    execSync(`node -e "require(String.raw\`${sqlitePath}\`)(':memory:')"`, {
      cwd: repoRoot,
      stdio: "pipe",
      shell: true,
    });
    return true;
  } catch {
    return false;
  }
}

function systemSqliteWorks() {
  try {
    execSync(`node -e "require('better-sqlite3')(':memory:')"`, {
      cwd: repoRoot,
      stdio: "pipe",
      shell: true,
    });
    return true;
  } catch {
    return false;
  }
}

if (systemSqliteWorks()) {
  console.log("[desktop] better-sqlite3 already targets system Node — skip test copy");
  process.exit(0);
}

if (!existsSync(sourceDir)) {
  throw new Error("better-sqlite3 not found — run npm install at repo root");
}

const sourceVersion = JSON.parse(
  readFileSync(path.join(sourceDir, "package.json"), "utf8"),
).version;

let copyVersion = "";
if (existsSync(path.join(copyDir, "package.json"))) {
  copyVersion = JSON.parse(
    readFileSync(path.join(copyDir, "package.json"), "utf8"),
  ).version;
}

if (copyVersion !== sourceVersion) {
  console.log("[desktop] refreshing test-native better-sqlite3 copy…");
  rmSync(copyDir, { recursive: true, force: true });
  mkdirSync(testNativeRoot, { recursive: true });
  cpSync(sourceDir, copyDir, {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}build${path.sep}`),
  });
}

if (!sqliteCopyWorks()) {
  console.log(
    `[desktop] installing better-sqlite3 prebuild for Node ${process.versions.node} (test copy)…`,
  );
  execSync(
    `npx prebuild-install --runtime node --target ${process.versions.node}`,
    { stdio: "inherit", cwd: copyDir, env: process.env },
  );
}

if (!sqliteCopyWorks()) {
  throw new Error(
    "[desktop] test-native better-sqlite3 still fails — install VS Build Tools or close locking processes",
  );
}

console.log("[desktop] test-native better-sqlite3 ready for Node tests");
