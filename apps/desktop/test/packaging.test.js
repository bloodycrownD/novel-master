import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, "..");

test("electron-builder --dir produces unpacked app", { timeout: 600_000 }, () => {
  const distMain = path.join(desktopRoot, "dist/src/main/main.js");
  assert.ok(
    existsSync(distMain),
    "dist/src/main/main.js missing — run npm run build -w @novel-master/desktop first",
  );

  const result = spawnSync(
    "npx",
    [
      "electron-builder",
      "--dir",
      "--publish",
      "never",
      "--config",
      "electron-builder.yml",
      "-c.npmRebuild=false",
    ],
    {
      cwd: desktopRoot,
      shell: true,
      stdio: "pipe",
      encoding: "utf8",
      env: { ...process.env, CI: undefined, ELECTRON_BUILDER_DISABLE_PUBLISH: "true" },
    },
  );

  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
  }
  assert.equal(result.status, 0, "electron-builder --dir failed");

  const releaseDir = path.join(desktopRoot, "release");
  assert.ok(existsSync(releaseDir), "release/ directory missing after --dir build");

  const winUnpacked = path.join(releaseDir, "win-unpacked");
  if (process.platform === "win32") {
    assert.ok(
      existsSync(path.join(winUnpacked, "Novel Master.exe")),
      "win-unpacked/Novel Master.exe missing",
    );
  }

  const macApp = path.join(releaseDir, "mac", "Novel Master.app");
  if (process.platform === "darwin") {
    assert.ok(existsSync(macApp), "mac/Novel Master.app missing");
  }
});
