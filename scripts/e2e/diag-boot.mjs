import { launchApp, shutdown } from "./lib.mjs";
const { app, page, vite } = await launchApp();
const sleep = (ms) => page.waitForTimeout(ms);
const step = async (label, fn) => { try { await fn(); console.log("OK", label); } catch (e) { console.log("FAIL", label, String(e).slice(0, 150)); } };
try {
  await page.waitForLoadState("domcontentloaded");
  await sleep(3000);
  await step("new-project", async () => {
    await page.locator("button:visible").filter({ hasText: "新建项目" }).first().click();
    await sleep(600);
    await page.locator("input:visible").first().fill("回归项目A");
    await page.locator("button:visible").filter({ hasText: /确定|创建/ }).first().click();
    await sleep(1200);
  });
  await step("open-settings", () => page.click('button[aria-label="打开设置"]', { timeout: 8000 }));
  await sleep(1000);
  await step("nav-agents", () => page.locator('[data-settings-nav="agentsSettings"]').click({ timeout: 8000 }));
  await sleep(1000);
  await step("click-new-agent", () => page.locator(".settings-view button").filter({ hasText: "新建 Agent" }).first().click({ timeout: 8000 }));
  await sleep(1000);
  const form = await page.evaluate(() => ({
    nameInput: !!document.querySelector('.settings-view .settings-field:has-text("名称") input'),
    visText: document.querySelector(".settings-view")?.textContent?.slice(0, 100),
  }));
  console.log("FORM", JSON.stringify(form));
} catch (e) { console.log("ERR", String(e).slice(0, 300)); }
await shutdown(app, vite);
