// bootstrap：重建测试库（项目/Agent/Provider/模型/会话/消息/工作区文件）
import { launchApp, shutdown, startMock, shot, sendMessage, goToProjects, openWorkspaceContextMenu, closeOverlays } from "./lib.mjs";

const errors = [];
const mock = await startMock();
const { app, page, vite } = await launchApp({ errors });
const sleep = (ms) => page.waitForTimeout(ms);

try {
  await page.waitForLoadState("domcontentloaded");
  await sleep(3500);
  await shot(page, "B0", "bootstrap-start");

  // 1. 项目
  await page.locator("button:visible").filter({ hasText: "新建项目" }).first().click();
  await sleep(500);
  await page.locator("input:visible").first().fill("回归项目A");
  await page.locator("button:visible").filter({ hasText: /确定|创建/ }).first().click();
  await sleep(1000);
  await shot(page, "B1", "project-created");

  console.log("PHASE", "agent-start");
  // 2. Agent（设置）
  await page.click('button[aria-label="打开设置"]');
  await sleep(600);
  await page.locator('[data-settings-nav="agentsSettings"]').click();
  await sleep(600);
  await page.locator(".settings-view button").filter({ hasText: "新建 Agent" }).first().click({ force: true });
  await sleep(1000);
  console.log("PHASE", "agent-form-open");
  await page.locator('.settings-view .settings-field:has-text("名称") input').first().fill("回归Agent");
  await page.locator(".settings-view button").filter({ hasText: "保存" }).first().click({ force: true });
  await sleep(1600);
  const agentSaved = await page.evaluate(() => ({
    toast: document.querySelector(".shell-toast.is-visible")?.textContent ?? null,
    navVisible: !!document.querySelector('[data-settings-nav="providers"]')?.offsetParent,
    overlays: [...document.querySelectorAll("[class*=modal]")].filter((m) => m.offsetParent).length,
  }));
  console.log("AGENT_SAVED", JSON.stringify(agentSaved));

  console.log("PHASE", "provider-start");
  // 3. Provider + baseUrl 指向 mock
  await page.locator('[data-settings-nav="providers"]').click();
  await sleep(1000);
  await page.locator(".settings-view button").filter({ hasText: "新建服务商" }).first().click({ force: true });
  await sleep(1000);
  await page.locator('.settings-view .settings-field:has-text("Base URL") input').first().fill("http://127.0.0.1:18099/v1");
  await page.locator('.settings-view .settings-field:has-text("服务商名称") input').first().fill("回归Provider");
  await page.locator('.settings-view input[type="password"]').first().fill("sk-regression-fake");
  await page.locator(".settings-view button").filter({ hasText: "创建" }).first().click();
  await sleep(1600);
  const provState = await page.evaluate(() => ({
    viewText: document.querySelector(".settings-view")?.textContent?.slice(0, 120),
    toast: document.querySelector(".shell-toast.is-visible")?.textContent ?? null,
  }));
  console.log("PROV_STATE", JSON.stringify(provState));
  // 模型管理加模型
  await page.locator(".settings-view button").filter({ hasText: "模型管理" }).first().click();
  await sleep(800);
  await page.locator(".settings-view button").filter({ hasText: "添加" }).first().click();
  await sleep(700);
  await page.locator(".settings-view input:visible").first().fill("glm-regression-test");
  await page.locator(".confirm-modal button, .settings-view button:visible").filter({ hasText: /^添加$/ }).last().click();
  await sleep(1000);
  await shot(page, "B2", "provider-model-ready");

  console.log("PHASE", "session-start");
  // 4. 回主界面建会话
  await page.click('button[aria-label="关闭设置"]').catch(() => page.keyboard.press("Escape"));
  await sleep(600);
  await goToProjects(page);
  await page.locator("li:visible").filter({ hasText: "回归项目A" }).first().click();
  await sleep(800);
  await page.locator("button:visible").filter({ hasText: "新建会话" }).first().click();
  await sleep(1500);
  await shot(page, "B3", "session-created");

  console.log("PHASE", "bind-model");
  // 5. 绑模型（抽屉）
  await page.locator('[data-action="open-session-actions"]').first().click();
  await sleep(900);
  await page.locator('[aria-label^="切换大模型"]').first().click();
  await sleep(800);
  // picker 列表选第二个（第一个是「清除会话覆盖」）
  await page.locator(".picker-modal__panel li:visible").nth(1).click();
  await sleep(800);
  // 收尾统一走 closeOverlays：旧版 Escape 循环 + backdrop force click 在「抽屉+picker 叠开」时
  // 关不干净（force click 落点被顶层 picker-modal__panel 接住，抽屉残留盖住树区，后续右键菜单弹不出）
  await closeOverlays(page);
  await sleep(400);
  await shot(page, "B4", "model-bound");

  // 6. 发几条消息（造数据 + 确认链路）
  await sendMessage(page, "回归引导消息1");
  await sleep(600);
  await sendMessage(page, "回归引导消息2：用于回滚/停止等用例的基础数据。");
  await sleep(600);
  await shot(page, "B5", "messages-sent");

  // 7. 工作区建文件（供引用/批注/树操作）
  await openWorkspaceContextMenu(page);
  await sleep(600);
  await page.locator('[data-workspace-action="create-file"]').first().click();
  await sleep(600);
  await page.locator("input:visible").first().fill("回归笔记.md");
  await page.locator("button:visible").filter({ hasText: /^确定$|^创建$/ }).first().click();
  await sleep(900);
  const node = page.locator(".tree-node").filter({ hasText: "回归笔记.md" }).first();
  await node.click(); await sleep(900);
  await page.locator('[aria-label="预览模式"] button').filter({ hasText: "编辑" }).first().click();
  await sleep(800);
  const cm = page.locator(".cm-content").first();
  if (await cm.count()) {
    await cm.click();
    await page.keyboard.type("# 回归笔记\n\n这是回归测试写入的正文内容，供批注与引用测试使用。\n\n- 列表项一\n- 列表项二\n", { delay: 3 });
    await page.keyboard.press("Control+s");
    await sleep(900);
  }
  await shot(page, "B6", "workspace-file-ready");

  const state = await page.evaluate(() => ({
    msgs: document.querySelectorAll(".chat-message").length,
    composerOk: (() => { const c = document.querySelector('textarea[aria-label="消息输入"]'); return c && !c.disabled; })(),
  }));
  console.log("BOOTSTRAP_STATE", JSON.stringify(state));

} catch (e) {
  console.log("SCRIPT_ERROR", String(e).slice(0, 500));
  try { await page.screenshot({ path: "/tmp/nm-desktop-e2e-out-err.png" }); } catch {}
}
await shutdown(app, vite, mock);
console.log("BOOTSTRAP_DONE errors:", errors.length, JSON.stringify(errors.slice(0, 3)));
