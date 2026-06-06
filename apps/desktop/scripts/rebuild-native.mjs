/**
 * Rebuild better-sqlite3 for Electron after npm install.
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

try {
  execSync(
    `npx @electron/rebuild -f -w better-sqlite3 -m "${repoRoot}" -v ${electronVersion}`,
    { stdio: "inherit", cwd: desktopRoot },
  );
} catch {
  console.warn(
    "[desktop] better-sqlite3 electron rebuild skipped (optional for dev).",
  );
}
