/**
 * Rebuild native modules for system Node (desktop unit/integration tests).
 * Electron dev uses scripts/rebuild-native.mjs instead — do not mix ABIs.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..", "..");
const sqliteDir = path.join(repoRoot, "node_modules", "better-sqlite3");

function sqliteWorksWithSystemNode() {
  try {
    execSync(`node -e "require('better-sqlite3')(':memory:')"`, {
      cwd: repoRoot,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

function installBetterSqliteNodePrebuild() {
  if (!existsSync(sqliteDir)) {
    throw new Error("better-sqlite3 not found — run npm install at repo root");
  }
  console.log(
    `[desktop] installing better-sqlite3 prebuild for Node ${process.versions.node}…`,
  );
  execSync(
    `npx prebuild-install --runtime node --target ${process.versions.node}`,
    { stdio: "inherit", cwd: sqliteDir, env: process.env },
  );
}

function rebuildBetterSqliteForNode() {
  execSync("npm rebuild better-sqlite3", {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

function rebuildDpapiForNode() {
  if (process.platform !== "win32") {
    return;
  }
  execSync("npm rebuild @primno/dpapi", {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

if (sqliteWorksWithSystemNode()) {
  console.log("[desktop] better-sqlite3 already targets system Node — skip rebuild");
  process.exit(0);
}

console.log("[desktop] preparing native modules for system Node (tests)…");

try {
  installBetterSqliteNodePrebuild();
} catch {
  console.warn(
    "[desktop] prebuild-install for Node failed — trying npm rebuild (close Electron if EBUSY)…",
  );
  rebuildBetterSqliteForNode();
}

try {
  rebuildDpapiForNode();
} catch (err) {
  console.warn(
    "[desktop] @primno/dpapi rebuild skipped — SKSP tests may fail until VS Build Tools are installed.",
  );
  console.warn(err instanceof Error ? err.message : err);
}

if (!sqliteWorksWithSystemNode()) {
  throw new Error(
    "[desktop] better-sqlite3 still fails under system Node. Close running Electron/dev processes and retry, or run:\n" +
      "  cd node_modules/better-sqlite3 && npx prebuild-install --runtime node --target " +
      process.versions.node,
  );
}

console.log(
  "[desktop] native modules ready for Node tests. Before Electron dev, run dev:electron (rebuilds for Electron).",
);
