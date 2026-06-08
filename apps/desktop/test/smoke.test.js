import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, "..");
const repoRoot = path.join(desktopRoot, "..", "..");
const packageJsonPath = path.join(desktopRoot, "package.json");
const prototypeDir = path.join(repoRoot, "examples", "desktop");

test("desktop package declares electron entrypoint", () => {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  assert.equal(pkg.main, "./dist/src/main/main.js");
  assert.equal(pkg.name, "@novel-master/desktop");
});

test("electron start scripts use start-electron launcher", () => {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const startScript = path.join(desktopRoot, "scripts", "start-electron.mjs");
  assert.ok(existsSync(startScript), "scripts/start-electron.mjs must exist");
  assert.match(pkg.scripts.start, /start-electron\.mjs/);
  assert.match(pkg.scripts["dev:electron"], /start-electron\.mjs/);
  assert.doesNotMatch(pkg.scripts.start, /\belectron\s+\.\s*$/);
  assert.doesNotMatch(pkg.scripts["dev:electron"], /\belectron\s+\.\s*$/);
});

test("desktop scaffold includes vite and electron-builder config", () => {
  assert.ok(existsSync(path.join(desktopRoot, "vite.config.ts")));
  assert.ok(existsSync(path.join(desktopRoot, "electron-builder.yml")));
  assert.ok(existsSync(path.join(desktopRoot, "tsconfig.renderer.json")));
});

test("preload exposes novelMasterDesktop IPC bridge API", () => {
  const preloadCjs = path.join(desktopRoot, "dist/src/preload/preload.cjs");
  assert.ok(
    existsSync(preloadCjs),
    "dist/src/preload/preload.cjs missing — run npm run build -w @novel-master/desktop",
  );
  const preloadBundle = readFileSync(preloadCjs, "utf8");
  assert.match(preloadBundle, /contextBridge\.exposeInMainWorld\("novelMasterDesktop"/);
  assert.match(
    preloadBundle,
    /customTitleBar:\s*process\.platform === "win32" \|\| process\.platform === "darwin"/,
  );
  assert.doesNotMatch(
    preloadBundle,
    /^\s*import\s+/m,
    "preload bundle must be CommonJS for sandboxed Electron",
  );
});

test("desktop runtime factory is wired in main process", () => {
  const runtimeFactory = readFileSync(
    path.join(desktopRoot, "src/main/runtime/create-desktop-runtime.ts"),
    "utf8",
  );
  assert.match(runtimeFactory, /export async function createDesktopNovelMasterRuntime/);
  assert.match(runtimeFactory, /registerPlatformSkspDriver|getPlatformSkspName/);
});

test("renderer build output exists after workspace build", () => {
  const rendererIndex = path.join(desktopRoot, "dist/renderer/index.html");
  assert.ok(
    existsSync(rendererIndex),
    "dist/renderer/index.html missing — run npm run build -w @novel-master/desktop",
  );
});

test("build/icons/icon.ico exists after build:icons", () => {
  const iconIco = path.join(desktopRoot, "build/icons/icon.ico");
  assert.ok(
    existsSync(iconIco),
    "build/icons/icon.ico missing — run npm run build:icons -w @novel-master/desktop",
  );
});

test("UI prototype lives under examples/desktop", () => {
  const html = readFileSync(path.join(prototypeDir, "index.html"), "utf8");
  assert.match(html, /id="preview-pane"/);
  assert.match(html, /id="explorer-pane"/);
  assert.match(html, /id="chat-rail"/);
  assert.match(html, /id="workspace-title"/);
  assert.ok(existsSync(path.join(prototypeDir, "shell.css")));
  assert.ok(existsSync(path.join(prototypeDir, "shell.js")));
});

test("apps/desktop has no createNovelMasterRuntime wiring", () => {
  const hits = [];
  const scanRoots = ["renderer", "src"].map((segment) =>
    path.join(desktopRoot, segment),
  );

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      const text = readFileSync(fullPath, "utf8");
      if (text.includes("createNovelMasterRuntime")) {
        hits.push(path.relative(desktopRoot, fullPath));
      }
    }
  }

  for (const root of scanRoots) {
    if (existsSync(root)) {
      walk(root);
    }
  }
  assert.deepEqual(
    hits,
    [],
    `createNovelMasterRuntime must not appear in apps/desktop: ${hits.join(", ")}`,
  );
});
