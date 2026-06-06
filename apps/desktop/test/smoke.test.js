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
  assert.equal(pkg.main, "./dist/main.js");
  assert.equal(pkg.name, "@novel-master/desktop");
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
    walk(root);
  }
  assert.deepEqual(
    hits,
    [],
    `createNovelMasterRuntime must not appear in apps/desktop: ${hits.join(", ")}`,
  );
});
