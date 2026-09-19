// v1.5.20 修复批次：case-agent-reselect——删除智能体后绑定它的会话可重选
// 断言：
//   AR-BIND——新建测试智能体并绑定到当前会话（抽屉 Agent picker）
//   AR-DELETED——设置页删除该智能体后，抽屉智能体卡显示「已删除 · 点击重选」（可点，非锁死）
//   AR-RESELECT——点击卡片弹 picker → 选回默认智能体 → 卡片恢复显示新智能体、发送可用
import {
  waitForAppReady, launchApp, shutdown, startMock, shot, sendMessage,
  closeOverlays, pickUsableSession, waitRunSettled,
} from "./lib.mjs";

const errors = [];
const results = [];
const record = (id, pass, detail = "") => {
  results.push({ id, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}${detail ? " " + detail : ""}`);
};
const step = async (id, fn) => {
  try { await fn(); } catch (e) { record(id, false, `EXCEPTION ${String(e).slice(0, 200)}`); }
};

const mock = await startMock();
const { app, page, vite } = await launchApp({ errors });
const sleep = (ms) => page.waitForTimeout(ms);

const RUN = String(Date.now() % 10000);
const TEST_AGENT = `重选智能体${RUN}`;
const FALLBACK_AGENT = "回归Agent";

// 智能体卡当前状态（抽屉内）
const agentCardState = () => page.evaluate(() => {
  const btn = document.querySelector('[data-session-detail-action="switch-agent"]');
  if (!btn) return { exists: false };
  return {
    exists: true,
    aria: btn.getAttribute("aria-label"),
    value: btn.querySelector(".session-detail-pick__value")?.textContent?.trim() ?? null,
    reselect: !!btn.querySelector(".session-detail-pick__lock--reselect"),
    reselectText: btn.querySelector(".session-detail-pick__lock--reselect")?.textContent?.trim() ?? null,
  };
});

try {
  await waitForAppReady(page);
  await pickUsableSession(page);
  await closeOverlays(page);
  await sleep(600);

  // ===== Part 1：设置页新建测试智能体 =====
  console.log("PHASE", "create-agent");
  await page.locator('button[aria-label="打开设置"]').click();
  await sleep(900);
  await page.locator('[data-settings-nav="agentsSettings"]').click();
  await sleep(900);
  await page.locator(".settings-view button").filter({ hasText: "新建 Agent" }).first().click();
  await sleep(1100);
  // 名称（AgentEditor 的名称 input 显式 type="text"）
  await page.locator('.settings-view .settings-field:has-text("名称") input[type="text"]').first().fill(TEST_AGENT);
  await sleep(300);
  await page.locator(".settings-view button").filter({ hasText: /^保存$/ }).first().click();
  await sleep(1600);
  const saveToast = await page.evaluate(() => document.querySelector(".shell-toast.is-visible")?.textContent ?? null);
  console.log("AGENT_SAVE_TOAST", JSON.stringify(saveToast));
  // 返回列表
  await page.locator('[data-action="settings-back"]').click();
  await sleep(900);
  const agentInList = await page.evaluate((n) =>
    [...document.querySelectorAll(".settings-list-item")].some((e) => e.textContent?.includes(n)), TEST_AGENT);
  console.log("AGENT_IN_LIST", agentInList);
  await shot(page, "830", "test-agent-created");
  if (!agentInList) throw new Error("测试智能体未出现在列表");

  // ===== Part 2：回会话绑定该智能体 =====
  console.log("PHASE", "bind-agent");
  await page.locator(".settings-main__close").click();
  await sleep(1000);
  await page.locator('[data-action="open-session-actions"]').first().click();
  await sleep(1100);
  await page.locator('[data-session-detail-action="switch-agent"]').first().click();
  await sleep(1000);
  // picker 按文本选测试智能体（agent picker 无「清除」首项，直接选目标行）
  await page.locator(".picker-modal__panel li").filter({ hasText: TEST_AGENT }).first().click();
  await sleep(1200);
  const bound = await agentCardState();
  console.log("BOUND_STATE", JSON.stringify(bound));
  await closeOverlays(page);
  await sleep(500);
  await shot(page, "831", "agent-bound");
  record("AR-BIND", bound.exists && bound.value === TEST_AGENT, `卡片=${JSON.stringify(bound)}`);

  // ===== Part 3：设置页删除该智能体 =====
  console.log("PHASE", "delete-agent");
  await page.locator('button[aria-label="打开设置"]').click();
  await sleep(900);
  await page.locator('[data-settings-nav="agentsSettings"]').click();
  await sleep(900);
  // 行菜单（⋮）：定位测试智能体所在行的 menu 按钮
  const menuClicked = await page.evaluate((n) => {
    const row = [...document.querySelectorAll(".settings-list-item-row")]
      .find((r) => r.querySelector(".settings-list-item")?.textContent?.includes(n));
    if (!row) return false;
    const btn = row.querySelector('.settings-list-item__menu-btn[aria-label="更多"]');
    if (!btn) return false;
    btn.click();
    return true;
  }, TEST_AGENT);
  console.log("AGENT_ROW_MENU_CLICKED", menuClicked);
  await sleep(800);
  await shot(page, "832", "agent-row-menu");
  // ContextMenu 删除项
  await page.locator(".context-menu [role=menuitem]").filter({ hasText: "删除" }).first().click();
  await sleep(800);
  const delConfirm = await page.evaluate(() => ({
    visible: (() => { const m = document.querySelector(".confirm-modal"); return !!m && !!m.offsetParent; })(),
    text: document.querySelector(".confirm-modal")?.textContent?.slice(0, 80) ?? null,
  }));
  console.log("DEL_CONFIRM", JSON.stringify(delConfirm));
  await shot(page, "833", "agent-delete-confirm");
  await page.locator(".confirm-modal button").filter({ hasText: "确定" }).first().click();
  await sleep(1400);
  const goneFromList = await page.evaluate((n) =>
    ![...document.querySelectorAll(".settings-list-item")].some((e) => e.textContent?.includes(n)), TEST_AGENT);
  console.log("AGENT_GONE_FROM_LIST", goneFromList);
  await page.locator(".settings-main__close").click();
  await sleep(1000);

  // ===== Part 4：抽屉断言「已删除 · 点击重选」 =====
  console.log("PHASE", "assert-deleted");
  await page.locator('[data-action="open-session-actions"]').first().click();
  await sleep(1300);
  let delState = await agentCardState();
  // meta 加载有 IPC 往返，轮询待 reselect 态落定（防「加载中…」态误判）
  for (let i = 0; i < 10 && !(delState.reselect); i++) {
    await sleep(400);
    delState = await agentCardState();
  }
  console.log("DELETED_STATE", JSON.stringify(delState));
  await shot(page, "834", "agent-deleted-reselect-badge");
  record("AR-DELETED",
    delState.reselect && (delState.reselectText ?? "").includes("智能体已删除 · 点击重选") && delState.aria === "切换智能体（待重选）",
    `卡片=${JSON.stringify(delState)}`);

  // ===== Part 5：点击重选 → picker → 选回默认智能体 =====
  console.log("PHASE", "reselect");
  await page.locator('[data-session-detail-action="switch-agent"]').first().click();
  await sleep(1100);
  const pickerOpen = await page.evaluate(() => !!document.querySelector(".picker-modal__panel"));
  console.log("PICKER_OPEN", pickerOpen);
  await shot(page, "835", "reselect-picker-open");
  await page.locator(".picker-modal__panel li").filter({ hasText: FALLBACK_AGENT }).first().click();
  await sleep(1400);
  const rebound = await agentCardState();
  console.log("REBOUND_STATE", JSON.stringify(rebound));
  await closeOverlays(page);
  await sleep(600);
  await shot(page, "836", "agent-reselected");

  // ===== Part 6：发送可用（走一轮 mock 生成）=====
  await step("AR-RESELECT", async () => {
    const pickerOk = pickerOpen;
    const cardOk = rebound.exists && rebound.value === FALLBACK_AGENT && !rebound.reselect;
    // 发送验证：composer 可用 + run 收敛
    const c = page.locator('textarea[aria-label="消息输入"]');
    const composerOk = (await c.count()) && !(await c.isDisabled().catch(() => true));
    let runOk = false;
    if (composerOk) {
      await sendMessage(page, "智能体重选后发送验证");
      const lastReply = await page.evaluate(() => {
        const msgs = [...document.querySelectorAll(".chat-message--assistant")].filter((m) => m.offsetParent);
        return msgs[msgs.length - 1]?.textContent ?? "";
      });
      runOk = lastReply.includes("收到，短回复");
      console.log("LAST_REPLY_OK", runOk);
    }
    record("AR-RESELECT", pickerOk && cardOk && composerOk && runOk,
      `picker开=${pickerOk} 卡片恢复=${cardOk} composer可用=${composerOk} run收敛=${runOk} 卡片=${JSON.stringify(rebound)}`);
  });

  // ===== 汇总 =====
  await closeOverlays(page);
  await shot(page, "837", "done");
  console.log("SUMMARY", JSON.stringify(results));
  const allPass = results.every((r) => r.pass);
  console.log("ALL_PASS", allPass);
  if (!allPass) process.exitCode = 1;

} catch (e) {
  console.log("SCRIPT_ERROR", String(e).slice(0, 500));
  process.exitCode = 1;
  try { await page.screenshot({ path: "/tmp/ar-reselect-err.png" }); } catch {}
}
await shutdown(app, vite, mock);
console.log("AR_RESELECT_DONE errors:", errors.length, JSON.stringify(errors.slice(0, 5)));
