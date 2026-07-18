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

const extraArgs = process.argv.slice(2).filter((arg) => arg.length > 0);
const testTargets =
  extraArgs.length > 0
    ? extraArgs.join(" ")
    : "test/**/*.test.ts test/**/*.test.tsx test/**/*.test.js";

execSync(
  `npx tsx --tsconfig tsconfig.renderer.json --test ${testTargets}`,
  { cwd: desktopRoot, stdio: "inherit", env, shell: true },
);

function mergeNodeOptions(existing, extra) {
  return existing ? `${existing} ${extra}` : extra;
}
