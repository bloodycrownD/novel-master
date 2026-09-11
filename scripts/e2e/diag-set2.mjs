import { launchApp, shutdown } from "./lib.mjs";
const { app, page, vite } = await launchApp();
const sleep = (ms) => page.waitForTimeout(ms);
try {
  await page.waitForLoadState("domcontentloaded");
  await sleep(3000);
  await page.click('button[aria-label="打开设置"]');
  await sleep(1200);
  await page.locator('[data-settings-nav="agentsSettings"]').click();
  await sleep(1200);
  const st = await page.evaluate(() => ({
    viewText: document.querySelector(".settings-view")?.textContent?.slice(0, 200),
    visBtns: [...document.querySelectorAll(".settings-view button")].filter((b) => b.offsetParent).map((b) => b.textContent?.trim().slice(0, 14)).filter(Boolean).slice(0, 12),
  }));
  console.log("AGENTS_PAGE", JSON.stringify(st, null, 1));
} catch (e) { console.log("ERR", String(e).slice(0, 300)); }
await shutdown(app, vite);
