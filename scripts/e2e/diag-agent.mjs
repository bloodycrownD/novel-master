import { launchApp, shutdown } from "./lib.mjs";
const { app, page, vite } = await launchApp();
const sleep = (ms) => page.waitForTimeout(ms);
const step = async (label, fn) => { try { await fn(); console.log("OK", label); } catch (e) { console.log("FAIL", label, String(e).slice(0, 120)); } };
try {
  await page.waitForLoadState("domcontentloaded");
  await sleep(3000);
  await step("open-settings", () => page.click('button[aria-label="打开设置"]', { timeout: 8000 }));
  await step("nav-agents", () => page.locator('[data-settings-nav="agentsSettings"]').click({ timeout: 8000 }));
  await sleep(800);
  await step("new-agent", () => page.locator(".settings-view button").filter({ hasText: "新建 Agent" }).first().click({ timeout: 8000 }));
  await sleep(900);
  await step("fill-name", () => page.locator(".settings-view .settings-field:has-text('名称') input").first().fill("回归Agent", { timeout: 8000 }));
  await step("save", () => page.locator(".settings-view button").filter({ hasText: "保存" }).first().click({ timeout: 8000 }));
  await sleep(1500);
  const after = await page.evaluate(() => ({
    viewText: document.querySelector(".settings-view")?.textContent?.slice(0, 80),
    toast: document.querySelector(".shell-toast.is-visible")?.textContent ?? null,
    navVisible: !!document.querySelector('[data-settings-nav="providers"]')?.offsetParent,
  }));
  console.log("AFTER_SAVE", JSON.stringify(after));
  await step("nav-providers", () => page.locator('[data-settings-nav="providers"]').click({ timeout: 8000 }));
} catch (e) { console.log("ERR", String(e).slice(0, 200)); }
await shutdown(app, vite);
