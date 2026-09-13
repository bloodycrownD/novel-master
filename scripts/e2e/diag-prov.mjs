// 诊断：Provider 创建挂起复现——launch 时 main stdout/stderr inherit，观察 ipcProvidersCreate 的 main 侧行为
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(E2E_DIR, "..", "..");
const DESKTOP = path.join(ROOT, "apps/desktop");
const DATA = path.join(E2E_DIR, "data");
const ELECTRON_BIN = path.join(ROOT, "node_modules", "electron", "dist", "electron");

function waitForPort(port, host, timeoutMs) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    (function tryOnce() {
      const s = net.connect({ port, host }, () => { s.destroy(); resolve(); });
      s.on("error", () => { s.destroy(); if (Date.now() - t0 > timeoutMs) return reject(new Error("port timeout")); setTimeout(tryOnce, 300); });
    })();
  });
}

fs.mkdirSync(DATA, { recursive: true });
const vite = spawn("npx", ["vite"], { cwd: DESKTOP, stdio: ["ignore", "pipe", "pipe"], detached: true });
await waitForPort(5173, "127.0.0.1", 60000);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.DISPLAY = env.DISPLAY || ":0";
env.NOVEL_MASTER_DB = path.join(DATA, "novel.db");
env.NOVEL_MASTER_DISABLE_UPDATE_CHECK = "1";
const app = await _electron.launch({
  executablePath: ELECTRON_BIN,
  args: ["."], cwd: DESKTOP, env,
  stdout: "inherit", stderr: "inherit", // main 进程日志直出终端
});
const page = await app.firstWindow();
const sleep = (ms) => page.waitForTimeout(ms);

await page.waitForLoadState("domcontentloaded");
await page.waitForSelector("#chat-rail", { timeout: 15000 });
await sleep(500);
// 打开设置 → providers → 新建服务商 → 填表 → 创建
await page.click('button[aria-label="打开设置"]');
await sleep(800);
await page.locator('[data-settings-nav="providers"]').click();
await sleep(800);
await page.locator(".settings-view button").filter({ hasText: "新建服务商" }).first().click({ force: true });
await sleep(1000);
await page.locator('.settings-view .settings-field:has-text("Base URL") input').first().fill("http://127.0.0.1:18099/v1");
await page.locator('.settings-view .settings-field:has-text("服务商名称") input').first().fill("回归Provider");
await page.locator('.settings-view input[type="password"]').first().fill("sk-regression-fake");
console.log("PROV_FORM_FILLED，点创建…");
await page.locator(".settings-view button").filter({ hasText: "创建" }).first().click();
for (let i = 1; i <= 6; i++) {
  await sleep(1000);
  const st = await page.evaluate(() => ({
    toast: document.querySelector(".shell-toast.is-visible")?.textContent ?? null,
    viewHead: document.querySelector(".settings-view")?.textContent?.slice(0, 60) ?? null,
  }));
  console.log(`PROV_T+${i}s`, JSON.stringify(st));
}
await shot("diag-prov-end");
async function shot(name) {
  await page.screenshot({ path: path.join(E2E_DIR, "out", `${name}.png`) });
}
try { process.kill(-vite.pid, "SIGKILL"); } catch {}
await app.close().catch(() => {});
process.exit(0);
