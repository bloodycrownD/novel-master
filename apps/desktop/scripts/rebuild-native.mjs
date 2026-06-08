/**
 * Rebuild Electron native modules after npm install.
 * better-sqlite3: all platforms. @primno/dpapi: Windows SKSP only.
 *
 * Strategy: @electron/rebuild when build tools exist; otherwise prebuild-install
 * for better-sqlite3 (published electron binaries). Silent skip caused dev
 * sessions to load NODE 127 prebuilds under Electron (MODULE 133).
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, "..");
const repoRoot = path.join(desktopRoot, "..", "..");

// @electron/rebuild must run as Node; IDE shells may set ELECTRON_RUN_AS_NODE=1.
delete process.env.ELECTRON_RUN_AS_NODE;

const pkg = JSON.parse(
  readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
);
const electronVersion =
  (pkg.devDependencies?.electron ?? "35.7.5").replace(/^[^\d]*/, "");

const nativeModules = ["better-sqlite3"];
if (process.platform === "win32") {
  nativeModules.push("@primno/dpapi");
}

const onlyModules = nativeModules.join(",");

function installBetterSqliteElectronPrebuild() {
  const sqliteDir = path.join(repoRoot, "node_modules", "better-sqlite3");
  if (!existsSync(sqliteDir)) {
    throw new Error("better-sqlite3 not found — run npm install at repo root");
  }
  console.log(
    `[desktop] installing better-sqlite3 prebuild for Electron ${electronVersion}…`,
  );
  execSync(
    `npx prebuild-install --runtime electron --target ${electronVersion}`,
    { stdio: "inherit", cwd: sqliteDir, env: process.env },
  );
}

/** Node can open the DB only when the .node binary targets system Node (wrong for Electron). */
function sqliteBinaryTargetsSystemNode() {
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

let rebuildOk = false;
try {
  execSync(
    `npx @electron/rebuild -f -o ${onlyModules} -m "${repoRoot}" -v ${electronVersion}`,
    { stdio: "inherit", cwd: desktopRoot },
  );
  rebuildOk = !sqliteBinaryTargetsSystemNode();
  if (!rebuildOk) {
    console.warn(
      "[desktop] better-sqlite3 still targets system Node after @electron/rebuild — using prebuild fallback…",
    );
  }
} catch {
  console.warn(
    "[desktop] @electron/rebuild failed (missing VS Build Tools?). Trying prebuild fallback…",
  );
}

if (!rebuildOk) {
  try {
    installBetterSqliteElectronPrebuild();
    if (process.platform === "win32") {
      console.warn(
        "[desktop] @primno/dpapi was not rebuilt — SKSP may fail until VS Build Tools are installed.",
      );
    }
  } catch (fallbackErr) {
    const hint = `cd node_modules/better-sqlite3 && npx prebuild-install --runtime electron --target ${electronVersion}`;
    if (process.env.CI) {
      console.error("[desktop] native module electron rebuild failed in CI.");
      throw fallbackErr;
    }
    console.error(
      "[desktop] native module rebuild failed. Install Desktop development with C++ (VS Build Tools), or run:\n  " +
        hint,
    );
    throw fallbackErr;
  }
}
