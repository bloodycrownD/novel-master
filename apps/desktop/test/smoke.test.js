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

test("desktop scaffold includes vite and electron-builder config", () => {
  assert.ok(existsSync(path.join(desktopRoot, "vite.config.ts")));
  assert.ok(existsSync(path.join(desktopRoot, "electron-builder.yml")));
  assert.ok(existsSync(path.join(desktopRoot, "tsconfig.renderer.json")));
});

test("preload exposes novelMasterDesktop IPC bridge API", () => {
  const preload = readFileSync(
    path.join(desktopRoot, "src/preload/preload.ts"),
    "utf8",
  );
  assert.match(preload, /contextBridge\.exposeInMainWorld\("novelMasterDesktop"/);
  assert.match(preload, /invoke/);
  assert.match(preload, /\bon\b/);
  assert.match(preload, /\boff\b/);
  assert.match(preload, /version/);
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
