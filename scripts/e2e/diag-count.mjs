import { launchApp, shutdown, goToProjects } from "./lib.mjs";
const { app, page, vite } = await launchApp();
const sleep = (ms) => page.waitForTimeout(ms);
try {
  await page.waitForLoadState("domcontentloaded");
  await sleep(3000);
  await goToProjects(page);
  await page.locator("li:visible").filter({ hasText: "回归项目A" }).first().click();
  await sleep(1200);
  const a = await page.locator("#chat-rail button:visible").filter({ hasText: "新建" }).count();
  const b = await page.locator("button:visible").filter({ hasText: "新建" }).count();
  const c = await page.evaluate(() => [...document.querySelectorAll("#chat-rail button")].filter((x) => x.offsetParent && x.textContent?.includes("新建")).map((x) => ({ cls: x.className.slice(0, 30), txt: x.textContent?.trim() })));
  console.log("counts:", { railNew: a, anyNew: b, dom: JSON.stringify(c) });
} catch (e) { console.log("ERR", String(e).slice(0, 200)); }
await shutdown(app, vite);
