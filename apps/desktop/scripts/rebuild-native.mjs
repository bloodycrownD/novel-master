/**
 * Rebuild Electron native modules after npm install.
 * better-sqlite3: all platforms. @primno/dpapi: Windows SKSP only.
 * Skips silently when build tools are unavailable (user can run manually).
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, "..");
const repoRoot = path.join(desktopRoot, "..", "..");

const pkg = JSON.parse(
  readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
);
const electronVersion =
  (pkg.devDependencies?.electron ?? "35.7.5").replace(/^[^\d]*/, "");

const nativeModules = ["better-sqlite3"];
if (process.platform === "win32") {
  nativeModules.push("@primno/dpapi");
}

const rebuildArgs = nativeModules.map((name) => `-w ${name}`).join(" ");

try {
  execSync(
    `npx @electron/rebuild -f ${rebuildArgs} -m "${repoRoot}" -v ${electronVersion}`,
    { stdio: "inherit", cwd: desktopRoot },
  );
} catch (err) {
  if (process.env.CI) {
    console.error("[desktop] native module electron rebuild failed in CI.");
    throw err;
  }
  console.warn(
    "[desktop] native module electron rebuild skipped (optional for dev).",
  );
}
