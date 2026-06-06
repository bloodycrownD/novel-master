import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, "..");
const packageJsonPath = path.join(desktopRoot, "package.json");
const rendererDir = path.join(desktopRoot, "renderer");

test("desktop package declares electron entrypoint", () => {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  assert.equal(pkg.main, "./dist/main.js");
  assert.equal(pkg.name, "@novel-master/desktop");
});

test("T3: renderer index.html declares three-pane shell roots", () => {
  const html = readFileSync(path.join(rendererDir, "index.html"), "utf8");
  assert.match(html, /id="preview-pane"/);
  assert.match(html, /id="explorer-pane"/);
  assert.match(html, /id="chat-rail"/);
  assert.match(html, /shell\.js/);
  assert.doesNotMatch(html, /index\.js/);
});

test("T4: shell.css and shell.js assets exist", () => {
  assert.ok(existsSync(path.join(rendererDir, "shell.css")));
  assert.ok(existsSync(path.join(rendererDir, "shell.js")));
});

test("T5: apps/desktop has no createNovelMasterRuntime wiring", () => {
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
    walk(root);
  }
  assert.deepEqual(
    hits,
    [],
    `createNovelMasterRuntime must not appear in apps/desktop: ${hits.join(", ")}`,
  );
});
