import { launchApp, shutdown } from "./lib.mjs";
const { app, page, vite } = await launchApp();
const sleep = (ms) => page.waitForTimeout(ms);
try {
  await page.waitForLoadState("domcontentloaded");
  await sleep(3500);
  await page.click('button[aria-label="打开设置"]');
  await sleep(1500);
  const st = await page.evaluate(() => ({
    overlay: !!document.querySelector(".settings-overlay, [class*=settings][class*=overlay]"),
    navCount: document.querySelectorAll("[data-settings-nav]").length,
    viewText: document.querySelector(".settings-view")?.textContent?.slice(0, 120) ?? null,
    anyModal: [...document.querySelectorAll("[class*=modal]")].filter((m) => m.offsetParent).map((m) => m.className.slice(0, 30)).slice(0, 3),
  }));
  console.log("SET_STATE", JSON.stringify(st, null, 1));
} catch (e) { console.log("ERR", String(e).slice(0, 300)); }
await shutdown(app, vite);
