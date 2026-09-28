// agent-config-tabs T-E1: 智能体配置页双 tab——默认主 tab、切子 tab 见 general 内置行、只读分支
import { waitForAppReady, launchApp, shutdown, shot, closeOverlays } from "./lib.mjs";

const errors = [];

const { app, page, vite } = await launchApp({ errors });
const sleep = (ms) => page.waitForTimeout(ms);

try {
  await waitForAppReady(page);

  // 1. 进设置 → 智能体配置
  await page.click('button[aria-label="打开设置"]');
  await sleep(700);
  await page.locator('[data-settings-nav="agentsSettings"]').click();
  await sleep(900);
  await shot(page, "650", "agents-tabs-primary");

  // 2. tab 控件存在：主智能体 / 子智能体，默认主 tab 选中
  const tabsBox = page.locator(".agents-manage__tabs").first();
  const tabBtn = (label) => page.locator(".agents-manage__tabs .segmented-control__btn").filter({ hasText: label }).first();
  const primaryActive = await tabBtn("主智能体").evaluate((el) => el.classList.contains("is-active")).catch(() => false);
  console.log("TABS_STATE", JSON.stringify({ container: await tabsBox.count(), primary: await tabBtn("主智能体").count(), subagent: await tabBtn("子智能体").count(), primaryActive }));
  if (!(await tabsBox.count()) || !(await tabBtn("主智能体").count()) || !(await tabBtn("子智能体").count()) || !primaryActive) {
    throw new Error("tab 控件缺失或主 tab 未默认选中");
  }

  // 3. 主 tab 不应出现 general 内置行（存量库里无同名用户 agent 时）
  const generalInPrimary = await page.locator(".settings-view").filter({ hasText: "general" }).count();
  console.log("PRIMARY_GENERAL_ROWS", generalInPrimary);

  // 4. 切子 tab → general 内置行 + 「内置」徽标
  await tabBtn("子智能体").click();
  await sleep(700);
  await shot(page, "651", "agents-tabs-subagent");
  const generalRow = page.locator(".settings-view .settings-list-item, .settings-view li, .settings-view [class*=item]").filter({ hasText: "general" }).first();
  const builtinTag = page.locator(".settings-view .settings-tag--primary").filter({ hasText: "内置" }).first();
  console.log("SUB_TAB_STATE", JSON.stringify({ generalRow: await generalRow.count(), builtinTag: await builtinTag.count() }));
  if (!(await generalRow.count()) || !(await builtinTag.count())) {
    throw new Error("子 tab 未见 general 内置行或「内置」徽标");
  }

  // 5. 点 general 行 → 只读分支（内置说明 + 无保存按钮）
  await generalRow.click({ force: true }).catch(async () => {
    await page.evaluate(() => {
      const row = [...document.querySelectorAll(".settings-view *")].find((el) => el.textContent === "general");
      row?.closest("li, [class*=item]")?.click();
    });
  });
  await sleep(1000);
  await shot(page, "652", "agents-general-readonly");
  const ro = await page.evaluate(() => {
    const text = document.querySelector(".settings-view")?.textContent ?? "";
    return {
      builtinNotice: text.includes("内置智能体"),
      noSave: ![...document.querySelectorAll(".settings-view button")].some((b) => b.textContent?.trim() === "保存"),
    };
  });
  console.log("READONLY_STATE", JSON.stringify(ro));
  if (!ro.builtinNotice || !ro.noSave) {
    throw new Error("general 只读分支缺失：内置说明或保存按钮异常");
  }

  await page.click('button[aria-label="关闭设置"]').catch(() => page.keyboard.press("Escape"));
  await sleep(500);
  await closeOverlays(page);
  console.log("AGENTS_TABS_OK");
} catch (e) {
  console.log("SCRIPT_ERROR", String(e).slice(0, 400));
  process.exitCode = 1; // 静默假绿防护：断言失败必须非零退出
  try { await page.screenshot({ path: "/tmp/agents-tabs-err.png" }); } catch {}
}
await shutdown(app, vite);
console.log("AGENTS_TABS_DONE errors:", errors.length, JSON.stringify(errors.slice(0, 3)));
