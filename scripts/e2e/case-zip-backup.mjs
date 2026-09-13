// R7-1: ZIP 导出/导入 + 备份导出/导入（patch 原生对话框）
import fs from "node:fs";
import { waitForAppReady, launchApp, shutdown, shot, goToProjects, openWorkspaceContextMenu } from "./lib.mjs";

const errors = [];
const { app, page, vite } = await launchApp({ errors });
const sleep = (ms) => page.waitForTimeout(ms);

// patch 原生对话框：保存返回预置路径，打开返回预置文件
const patchRes = await app.evaluate(({ savePath, openPath }) => {
  const binding = process._linkedBinding("electron_browser_dialog");
  try {
    const patched = { save: false, open: false };
    if (binding.showSaveDialog) { try { binding.showSaveDialog = function () { return [savePath]; }; patched.save = true; } catch (e) {} }
    if (binding.showOpenDialog) { try { binding.showOpenDialog = function () { return [openPath]; }; patched.open = true; } catch (e) {} }
    return patched;
  } catch (e) { return { err: String(e) }; }
}, { savePath: "/tmp/nm-e2e-export.zip", openPath: "/tmp/nm-e2e-export.zip" });
console.log("DIALOG_PATCHED", JSON.stringify(patchRes));
console.log("DIALOG_PATCHED");

try {
  // app 就绪条件等待（原固定 sleep(3500)，见 lib.mjs waitForAppReady 说明）
  await waitForAppReady(page);
  await goToProjects(page);
  await page.locator("li:visible").filter({ hasText: "回归项目A" }).first().click();
  await sleep(800);
  await page.locator("#session-list li:visible").first().click();
  await sleep(1200);

  // ===== 1. 导出 ZIP（根目录右键）=====
  const rootNode = page.locator(".tree-node").first();
  const box = await rootNode.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 8, { button: "right" });
  await sleep(700);
  await page.locator('[data-workspace-action="export-zip"]').first().click();
  await sleep(1800); // 导出+写盘
  await shot(page, "620", "zip-exported");
  const zipOk = fs.existsSync("/tmp/nm-e2e-export.zip");
  const zipSize = zipOk ? fs.statSync("/tmp/nm-e2e-export.zip").size : 0;
  console.log("ZIP_EXPORTED", zipOk, "size:", zipSize);

  // ===== 2. 导入 ZIP（树空白右键；工作区有文件时覆盖确认）=====
  await openWorkspaceContextMenu(page);
  await sleep(600);
  await page.locator('[data-workspace-action="import-zip"]').first().click();
  await sleep(1000);
  // 可能弹覆盖确认
  const ovText = await page.evaluate(() => document.querySelector(".confirm-modal")?.textContent?.slice(0, 120) ?? null);
  console.log("IMPORT_CONFIRM", JSON.stringify(ovText));
  if (ovText) {
    const okb = page.locator(".confirm-modal button").filter({ hasText: /确定|导入|覆盖/ }).first();
    if (await okb.count()) { await okb.click(); await sleep(1500); }
  } else { await sleep(1200); }
  await shot(page, "621", "zip-imported");
  const importToast = await page.evaluate(() => document.querySelector(".shell-toast.is-visible")?.textContent?.slice(0, 100) ?? null);
  console.log("IMPORT_TOAST", JSON.stringify(importToast));

  // ===== 3. 备份导出（设置→备份与恢复）=====
  await page.click('button[aria-label="打开设置"]');
  await sleep(800);
  await page.locator('[data-settings-nav="dataManagement"]').click();
  await sleep(900);
  await page.locator(".settings-view button").filter({ hasText: "导出数据库" }).first().click();
  await sleep(1500);
  await shot(page, "622", "backup-export");
  const bkOk = fs.existsSync("/tmp/nm-e2e-export.zip");
  console.log("BACKUP_EXPORTED(saved to patch path)", bkOk, fs.existsSync("/tmp/nm-e2e-export.zip") ? fs.statSync("/tmp/nm-e2e-export.zip").size : 0);

  // ===== 4. 备份导入（同一文件→完全替换确认）=====
  await page.locator(".settings-view button").filter({ hasText: "导入数据库" }).first().click();
  await sleep(900);
  const impC = await page.evaluate(() => document.querySelector(".confirm-modal")?.textContent?.slice(0, 150) ?? null);
  console.log("BACKUP_IMPORT_CONFIRM", JSON.stringify(impC));
  await shot(page, "623", "backup-import-confirm");
  // 危险操作：确认它（替换为同一份库=数据不变，安全）
  const okb2 = page.locator(".confirm-modal button").filter({ hasText: /确定|导入/ }).first();
  if (await okb2.count()) { await okb2.click(); await sleep(2500); }
  await shot(page, "624", "backup-imported");
  const afterImport = await page.evaluate(() => document.querySelector(".shell-toast.is-visible")?.textContent?.slice(0, 80) ?? document.querySelector(".settings-view")?.textContent?.slice(0, 60) ?? null);
  console.log("AFTER_BACKUP_IMPORT", JSON.stringify(afterImport));

} catch (e) {
  console.log("SCRIPT_ERROR", String(e).slice(0, 400));
    process.exitCode = 1; // 静默假绿防护：断流必须非零退出
  try { await page.screenshot({ path: "/tmp/r71-err.png" }); } catch {}
}
await shutdown(app, vite);
console.log("R71_DONE errors:", errors.length, JSON.stringify(errors.slice(0, 3)));
