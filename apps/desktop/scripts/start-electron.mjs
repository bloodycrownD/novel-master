/**
 * Spawn Electron in GUI mode even when the parent shell sets ELECTRON_RUN_AS_NODE=1
 * (e.g. IDE-integrated terminals). Only the child env is cleared — not process.env.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, "..");
const require = createRequire(import.meta.url);
const electronPath = require("electron");

const env = { ...process.env };
// Child-only: without this, require('electron') in the main process returns a path string.
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ["."], {
  cwd: desktopRoot,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
