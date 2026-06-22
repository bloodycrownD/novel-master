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

execSync(
  "npx tsx --tsconfig tsconfig.renderer.json --test test/**/*.test.ts test/**/*.test.js",
  { cwd: desktopRoot, stdio: "inherit", env, shell: true },
);

function mergeNodeOptions(existing, extra) {
  return existing ? `${existing} ${extra}` : extra;
}
