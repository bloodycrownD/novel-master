// R6-1: 会话/项目 删除 + 批量管理模式
import { launchApp, shutdown, shot, goToProjects } from "./lib.mjs";

const errors = [];
const { app, page, vite } = await launchApp({ errors });
const sleep = (ms) => page.waitForTimeout(ms);

try {
  await page.waitForLoadState("domcontentloaded");
  await sleep(3500);
  await goToProjects(page);
  const st0 = await page.evaluate(() => ({
    vis: [...document.querySelectorAll(".chat-nav-view")].filter((v) => !v.hidden).map((v) => v.getAttribute("data-nav-view")),
    lis: [...document.querySelectorAll("li")].filter((l) => l.offsetParent).map((l) => l.textContent?.slice(0, 20)).slice(0, 6),
    btns: [...document.querySelectorAll("#chat-rail button")].filter((b) => b.offsetParent).map((b) => b.textContent?.trim().slice(0, 10)).filter(Boolean).slice(0, 10),
  }));
  console.log("ST0", JSON.stringify(st0));
  await page.locator("li:visible").filter({ hasText: "回归项目A" }).first().click();
  await sleep(1200);
  const st1 = await page.evaluate(() => ({
    vis: [...document.querySelectorAll(".chat-nav-view")].filter((v) => !v.hidden).map((v) => v.getAttribute("data-nav-view")),
    sessRows: document.querySelectorAll("#session-list > li").length,
    btns: [...document.querySelectorAll("#chat-rail button")].filter((b) => b.offsetParent).map((b) => b.textContent?.trim().slice(0, 10)).filter(Boolean).slice(0, 10),
  }));
  console.log("ST1", JSON.stringify(st1));

  // 1. 建 3 个牺牲会话
  for (let i = 1; i <= 3; i++) {
    // 新建后自动进入会话——先逐层返回 sessions 列表
    for (let k = 0; k < 3; k++) {
      const vis = await page.evaluate(() => [...document.querySelectorAll(".chat-nav-view")].filter((v) => !v.hidden).map((v) => v.getAttribute("data-nav-view")));
      if (vis.includes("sessions")) break;
      const bk = page.locator('button[aria-label="返回"]:visible').first();
      if (await bk.count()) { await bk.click(); await sleep(600); } else break;
    }
    const newSessBtn = page.locator("#chat-rail button:visible").filter({ hasText: "新建" }).first();
    await newSessBtn.click();
    await sleep(1300);
  }
  // 建完回 sessions 列表
  for (let k = 0; k < 3; k++) {
    const vis = await page.evaluate(() => [...document.querySelectorAll(".chat-nav-view")].filter((v) => !v.hidden).map((v) => v.getAttribute("data-nav-view")));
    if (vis.includes("sessions")) break;
    const bk = page.locator('button[aria-label="返回"]:visible').first();
    if (await bk.count()) { await bk.click(); await sleep(600); } else break;
  }
  const sessCount = await page.evaluate(() => document.querySelectorAll("#session-list > li").length);
  console.log("SESSIONS_BEFORE", sessCount);
  await shot(page, "600", "sessions-batch-ready");

  // 2. 批量管理模式
  await page.locator("button:visible").filter({ hasText: "管理" }).first().click();
  await sleep(900);
  await shot(page, "601", "batch-mode-on");
  const batchState = await page.evaluate(() => ({
    checkboxes: [...document.querySelectorAll('input[type=checkbox], [class*=checkbox], [role=checkbox]')].filter((c) => c.offsetParent).length,
    hasBatchBar: !!document.querySelector("[class*=batch]"),
    text: document.querySelector("#chat-rail")?.textContent?.slice(0, 80),
  }));
  console.log("BATCH_STATE", JSON.stringify(batchState));

  // 勾选 2 个（点会话行）+ 全选/删除按钮探测
  const rows = page.locator("#session-list li:visible");
  const n = await rows.count();
  for (let i = 0; i < Math.min(2, n); i++) { await rows.nth(i).click(); await sleep(300); }
  await shot(page, "602", "batch-selected");
  const batchBtns = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => b.offsetParent && /删除|全选|取消/.test(b.textContent || "")).map((b) => b.textContent?.trim().slice(0, 10)).slice(0, 6));
  console.log("BATCH_BTNS", JSON.stringify(batchBtns));
  // 批量删除
  const delBtn = page.locator("button:visible").filter({ hasText: /^删除/ }).first();
  if (await delBtn.count()) {
    await delBtn.click();
    await sleep(800);
    const okb = page.locator(".confirm-modal button").filter({ hasText: /删除|确定/ }).first();
    if (await okb.count()) { await okb.click(); await sleep(1200); }
  }
  const afterDel = await page.evaluate(() => document.querySelectorAll("#session-list > li").length);
  console.log("SESSIONS_AFTER_BATCH_DEL", afterDel);
  await shot(page, "603", "batch-deleted");
  // 退出管理模式
  const exitBtn = page.locator("button:visible").filter({ hasText: /^完成|取消管理|退出/ }).first();
  if (await exitBtn.count()) { await exitBtn.click(); await sleep(600); }

  // 3. 单个会话行菜单删除（⋮）
  const row = page.locator("#session-list li:visible").first();
  if (await row.count()) {
    const menuBtn = row.locator('button[aria-label*="会话"], button:has-text("⋮")').last();
    const title0 = await row.textContent();
    await menuBtn.click();
    await sleep(700);
    await shot(page, "604", "session-row-menu");
    await page.locator("button:visible, [role=menuitem]:visible").filter({ hasText: "删除" }).first().click();
    await sleep(700);
    const okb2 = page.locator(".confirm-modal button").filter({ hasText: /删除|确定/ }).first();
    if (await okb2.count()) { await okb2.click(); await sleep(1000); }
    const gone = await page.evaluate((t) => ![...document.querySelectorAll("#session-list > li")].some((l) => l.textContent === t), title0);
    console.log("SESSION_ROW_DELETED", gone);
  }

  // 4. 项目删除：回 projects 建牺牲项目再删（先确保退出批量管理态）
  await goToProjects(page);
  const cancelMgmt = page.locator("button:visible").filter({ hasText: /^取消$/ }).first();
  if (await cancelMgmt.count()) { await cancelMgmt.click(); await sleep(700); }
  await page.locator("button:visible").filter({ hasText: "新建" }).first().click();
  await sleep(600);
  await page.locator("input:visible").first().fill("牺牲项目X");
  await page.locator("button:visible").filter({ hasText: /确定|创建/ }).first().click();
  await sleep(1000);
  await sleep(800);
  // 创建成功会自动进入新项目（ChatRail handleNamePromptConfirm → openProject），
  // 同名被拒则停留原地——两种情况都先清残留弹窗再回项目列表找行删除
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(400);
  await goToProjects(page);
  const projList = await page.evaluate(() => [...document.querySelectorAll("li")].filter((l) => l.offsetParent).map((l) => l.textContent?.slice(0, 24)).slice(0, 6));
  console.log("PROJ_LIST", JSON.stringify(projList));
  const pRow = page.locator("li:visible").filter({ hasText: "牺牲项目X" }).first();
  console.log("pRow count:", await pRow.count());
  const pMenuInfo = await page.evaluate(() => {
    const li = [...document.querySelectorAll("li")].find((l) => l.offsetParent && l.textContent?.includes("牺牲项目X"));
    return li ? { btns: [...li.querySelectorAll("button")].map((b) => ({ aria: b.getAttribute("aria-label"), vis: !!b.offsetParent, txt: b.textContent?.trim().slice(0,4) })) } : null;
  });
  console.log("PMENU_INFO", JSON.stringify(pMenuInfo));
  const pMenu = pRow.locator("button").last();
  await pMenu.click();
  await sleep(700);
  await page.locator("button:visible, [role=menuitem]:visible").filter({ hasText: "删除" }).first().click();
  await sleep(700);
  await shot(page, "605", "project-delete-confirm");
  const ctext = await page.evaluate(() => document.querySelector(".confirm-modal")?.textContent?.slice(0, 150) ?? null);
  console.log("PROJ_DEL_CONFIRM", JSON.stringify(ctext));
  const okb3 = page.locator(".confirm-modal button").filter({ hasText: /删除|确定/ }).first();
  if (await okb3.count()) { await okb3.click(); await sleep(1100); }
  const pGone = await page.locator("li:visible").filter({ hasText: "牺牲项目X" }).count() === 0;
  console.log("PROJECT_DELETED", pGone);
  await shot(page, "606", "project-deleted");

} catch (e) {
  console.log("SCRIPT_ERROR", String(e).slice(0, 400));
  try { await page.screenshot({ path: "/tmp/sess-mgmt-err.png" }); } catch {}
}
await shutdown(app, vite);
console.log("SESS_MGMT_DONE errors:", errors.length, JSON.stringify(errors.slice(0, 3)));
