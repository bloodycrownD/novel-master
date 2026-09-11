// R6-2: 模型重命名/删除/全选 + 技能行菜单删除/域切换 + YAML 导入导出补验
import { launchApp, shutdown, shot } from "./lib.mjs";

const errors = [];
const { app, page, vite } = await launchApp({ errors });
const sleep = (ms) => page.waitForTimeout(ms);

try {
  await page.waitForLoadState("domcontentloaded");
  await sleep(3500);

  // ===== A. 模型管理：拉取(已有3模型场景跳过) → 全选/删除 =====
  await page.click('button[aria-label="打开设置"]');
  await sleep(800);
  await page.locator('[data-settings-nav="providers"]').click();
  await sleep(800);
  await page.locator(".settings-view .settings-list-item").filter({ hasText: "回归Provider" }).first().click();
  await sleep(900);
  await page.locator(".settings-view button").filter({ hasText: "模型管理" }).first().click();
  await sleep(1000);
  await shot(page, "610", "model-manage-list");
  const mmBefore = await page.evaluate(() => ({
    // 模型行是 SettingsListItem 渲染的 div.settings-list-item（非 li、无 model-item 类）
    models: [...document.querySelectorAll(".settings-view .settings-list-item")].filter((e) => e.offsetParent).map((e) => e.textContent?.slice(0, 40)).slice(0, 6),
  }));
  console.log("MM_BEFORE", JSON.stringify(mmBefore));

  // 进批量模式（「全选/删除」是 ManageHeader batchMode 条件渲染，须先点「管理」）
  const manageBtn = page.locator(".settings-view button:visible").filter({ hasText: "^管理$" }).first();
  await manageBtn.click();
  await sleep(600);

  // 全选 → 删除（若批量 UI 存在）
  const selAll = page.locator(".settings-view button:visible").filter({ hasText: "全选" }).first();
  if (await selAll.count()) { await selAll.click(); await sleep(500); }
  const delModel = page.locator(".settings-view button:visible").filter({ hasText: /^删除/ }).first();
  if (await delModel.count()) {
    await delModel.click();
    await sleep(700);
    const okb = page.locator(".confirm-modal button").filter({ hasText: /删除|确定/ }).first();
    if (await okb.count()) { await okb.click(); await sleep(1000); }
    const mmAfter = await page.evaluate(() => document.querySelectorAll(".settings-view [class*=model-item], .settings-view li").length);
    console.log("MM_AFTER_DEL", mmAfter);
    await shot(page, "611", "models-batch-deleted");
  }

  // 手动添加一个模型（供后续绑定用）——AddModelModal 为 text-prompt-modal 结构；
  // 旧 .confirm-modal 定位随组件重构已漂移：点不到确认钮会残留弹窗，挡住 B 段侧导航
  await page.locator(".settings-view button").filter({ hasText: "添加" }).first().click();
  await sleep(700);
  const mi = page.locator(".text-prompt-modal input:visible").first();
  if (await mi.count()) {
    await mi.fill("glm-regression-test");
    const addOk = page.locator(".text-prompt-modal button").filter({ hasText: /^添加$/ }).first();
    if (await addOk.count()) { await addOk.click(); await sleep(900); }
  }
  const mmCount = await page.locator(".settings-view .settings-list-item").filter({ hasText: "glm-regression-test" }).count();
  console.log("MODEL_READDED", mmCount >= 1);
  if (mmCount < 1) console.log("FAIL MODEL_READDED", mmCount);

  // ===== B. 技能管理：行菜单删除「回归技能」 + 域切换 =====
  // 清场：关掉可能残留的弹窗（confirm-modal 与 text-prompt-modal 两类）
  for (let i = 0; i < 4; i++) {
    const anyModal = await page.evaluate(() => !!document.querySelector(".confirm-modal, .text-prompt-modal"));
    if (!anyModal) break;
    const cb = page.locator(".confirm-modal button, .text-prompt-modal button").filter({ hasText: "取消" }).first();
    if (await cb.count()) { await cb.click().catch(() => {}); await sleep(500); }
    else { await page.keyboard.press("Escape").catch(() => {}); await sleep(400); }
  }
  await page.locator('[data-settings-nav="skillsManage"]').click();
  await sleep(1000);
  await shot(page, "612", "skills-list-domains");
  // 域切换：全局 ↔ 项目
  const projTab = page.locator(".settings-view button:visible, .settings-view [role=tab]:visible").filter({ hasText: "项目技能" }).first();
  const projTab2 = page.locator(".settings-view button:visible").filter({ hasText: "项目" }).first();
  const tabBtn = (await projTab.count()) ? projTab : projTab2;
  if (await tabBtn.count()) {
    await tabBtn.click();
    await sleep(900);
    await shot(page, "613", "skills-project-domain");
    await tabBtn.click(); // 或切回
    await sleep(700);
  }
  // 行菜单删除回归技能
  const srow = page.locator(".settings-view .settings-list-item").filter({ hasText: "回归技能" }).first();
  if (await srow.count()) {
    const smenu = srow.locator("button").last();
    await smenu.click();
    await sleep(700);
    await shot(page, "614", "skill-row-menu");
    await page.locator("button:visible, [role=menuitem]:visible").filter({ hasText: "删除" }).first().click();
    await sleep(700);
    const okb2 = page.locator(".confirm-modal button").filter({ hasText: /删除|确定/ }).first();
    if (await okb2.count()) { await okb2.click(); await sleep(1000); }
    console.log("SKILL_ROW_DELETED", (await page.locator(".settings-view .settings-list-item").filter({ hasText: "回归技能" }).count()) === 0);
  } else { console.log("SKILL_ROW_NOT_FOUND(可能已删)"); }

  // ===== C. Agent YAML 导出/导入补验（D-13）=====
  for (let i = 0; i < 4; i++) {
    const anyModal = await page.evaluate(() => !!document.querySelector(".confirm-modal, .text-prompt-modal"));
    if (!anyModal) break;
    const cb = page.locator(".confirm-modal button, .text-prompt-modal button").filter({ hasText: "取消" }).first();
    if (await cb.count()) { await cb.click().catch(() => {}); await sleep(500); }
    else { await page.keyboard.press("Escape").catch(() => {}); await sleep(400); }
  }
  await page.locator('[data-settings-nav="agentsSettings"]').click();
  await sleep(800);
  await page.locator(".settings-view .settings-list-item").filter({ hasText: "回归Agent" }).first().click();
  await sleep(1500);
  // 导出：精确「导出 YAML」（避免撞「导入 YAML」——含"YAML"子串）
  const exportBtn = page.locator(".settings-view button").filter({ hasText: "导出 YAML" }).first();
  if (await exportBtn.count()) {
    await exportBtn.click({ force: true });
    await sleep(1500);
    await shot(page, "615", "yaml-export-clicked");
    const expState = await page.evaluate(() => ({
      modal: document.querySelector(".confirm-modal")?.textContent?.slice(0, 100) ?? null,
      downloads: window.__nmDownloadTriggered ?? null,
      bodyTail: document.body.textContent?.slice(-200),
    }));
    console.log("YAML_EXPORT_STATE", JSON.stringify(expState).slice(0, 300));
    // 导出的去向：Electron saveDialog（原生对话框）→ 无法自动确认，取消掉
    const cancelB = page.locator(".confirm-modal button").filter({ hasText: "取消" }).first();
    if (await cancelB.count()) { await cancelB.click(); await sleep(500); }
  }

} catch (e) {
  console.log("SCRIPT_ERROR", String(e).slice(0, 400));
  try { await page.screenshot({ path: "/tmp/r62-err.png" }); } catch {}
}
await shutdown(app, vite);
console.log("R62_DONE errors:", errors.length, JSON.stringify(errors.slice(0, 3)));
