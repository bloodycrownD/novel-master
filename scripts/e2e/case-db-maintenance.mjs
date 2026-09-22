// 用例：设置 → 备份与恢复 → 数据清理（storage-cache-dedup-and-cleanup feature B）
// 覆盖：体积/可回收展示、清理确认弹窗、清理执行、前后体积 toast、库文件实际缩小、GC 不误删被引用 blob
// 前置：首轮启动建库后，由 seed-maintenance.py 塞孤儿 blob（可回收量）与正常引用对（误删探针）
import { launchApp, shutdown, waitForAppReady, shot, waitForToast } from "./lib.mjs";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(E2E_DIR, "data");
const DB = path.join(DATA, "novel.db");
const errors = [];

function dbSize() {
  return fs.statSync(DB).size;
}

function seed() {
  execSync(`python ${path.join(E2E_DIR, "seed-maintenance.py")} "${DB}"`, { stdio: "pipe" });
}

function probeBlobs() {
  const out = execSync(`python ${path.join(E2E_DIR, "probe-maintenance.py")} "${DB}"`, { encoding: "utf8" });
  return JSON.parse(out);
}

// ---------- 首轮：建库 ----------
{
  const { app, page } = await launchApp({ errors });
  await waitForAppReady(page);
  await shutdown(app);
}
console.log("BOOT1_OK", "库已创建", dbSize(), "bytes");

// ---------- 造数据：孤儿 blob × 6MB（无 entry 引用）+ 正常引用对（误删探针） ----------
seed();
const sizeSeeded = dbSize();
console.log("SEEDED", sizeSeeded, "bytes");

// ---------- 二轮：走数据清理 UI 全流程 ----------
const { app, page } = await launchApp({ errors });
await waitForAppReady(page);

// 打开设置 → 数据管理
await page.click('button[aria-label="打开设置"]');
await page.waitForSelector('[data-settings-nav="dataManagement"]', { timeout: 8000 });
await page.click('[data-settings-nav="dataManagement"]');
await page.waitForSelector('.settings-section--action .settings-section__title:has-text("数据清理")', { timeout: 8000 });

const section = page.locator('.settings-section--action:has(.settings-section__title:text("数据清理"))').first();
await shot(page, "01", "dm-initial", 1200);
const descBefore = (await section.locator(".settings-section__desc").textContent()) ?? "";
console.log("DESC_BEFORE", descBefore.trim());

// 点清理 → 确认弹窗
await section.locator('button:has-text("清理")').first().click();
await page.waitForSelector('.confirm-modal:has-text("确认清理")', { timeout: 8000 });
await shot(page, "02", "confirm-modal", 600);

// 确认执行 → 等成功 toast（better-sqlite3 同步 VACUUM 冻住 main，窗口放宽）
await page.locator('.confirm-modal button:has-text("确定")').first().click();
const toast = await waitForToast(page, "清理完成", 30000);
await shot(page, "03", "toast-done", 300);
console.log("TOAST", toast ?? "(missed)");

// 等 desc 刷新（reloadDbStats 在 toast 后触发）
await page.waitForTimeout(2000);
await shot(page, "04", "dm-after", 800);
const descAfter = (await section.locator(".settings-section__desc").textContent()) ?? "";
console.log("DESC_AFTER", descAfter.trim());

await shutdown(app);

// ---------- 收口断言 ----------
const sizeAfter = dbSize();
const probe = probeBlobs();
const results = {
  toastHasCompare: toast != null && toast.includes("→"),
  descChanged: descBefore.trim() !== descAfter.trim(),
  sizeShrunk: sizeAfter < sizeSeeded,
  orphanCollected: probe.orphanBlobs === 0,
  keptBlobSurvived: probe.keptBlobs === 1,
  errorsEmpty: errors.length === 0,
  sizeSeeded,
  sizeAfter,
  probe,
  errors: errors.slice(0, 10),
};
console.log("RESULT", JSON.stringify(results, null, 2));
const pass = results.toastHasCompare && results.descChanged && results.sizeShrunk && results.orphanCollected && results.keptBlobSurvived && results.errorsEmpty;
console.log(pass ? "CASE_PASS" : "CASE_FAIL");
process.exit(pass ? 0 : 1);
