// B4 批次（v1.5.19 桌面端）：生成失败 / 空回复后输入框解锁 + 提示消息落库
//
// 场景：
//   RF-ERROR——mock 上游 HTTP 500 → run 失败 → 会话尾部落 assistant 提示消息
//            「[生成失败] xxx」，composer 解禁（textarea 可输入）
//   RF-PERSIST——失败后返回会话列表再重进，[生成失败] 提示仍在（落库而非易失）
//   RF-RECOVER——失败后立即可改写重发，正常回复到达（解锁的完整闭环）
//   RF-EMPTY——mock 成功但 SSE 无 content（空回复）→ 落「（本次生成无内容输出）」
//   RF-UNLOCK-EMPTY——空回复后 composer 解禁，重发正常消息可成功
//
// 运行：DBUS_SESSION_BUS_ADDRESS=$(cat /tmp/nm-e2e-dbus-addr) node case-run-fail-unlock.mjs

import { launchApp, startMock, shot, pickUsableSession, sendMessage, shutdown, waitForAppReady } from "./lib.mjs";

const results = [];
const record = (id, pass, detail = "") => {
  results.push({ id, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} ${detail}`);
};

const lastAssistantText = (page) =>
  page.evaluate(() => {
    const msgs = [...document.querySelectorAll(".chat-message--assistant")].filter((m) => m.offsetParent);
    return msgs.length ? msgs[msgs.length - 1].textContent : "";
  });

// 轮询等「最后一条可见 assistant 消息」命中关键词（失败/空回复提示的落库有 IPC 时序）
async function waitLastAssistant(page, needle, timeoutMs = 8000) {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < timeoutMs) {
    last = await lastAssistantText(page);
    if (last.includes(needle)) return last;
    await page.waitForTimeout(400);
  }
  return last;
}

const errors = [];
const { app, page, vite } = await launchApp({ errors });
try {
  const mock = await startMock({
    replyFor: (userText) => {
      if (userText.includes("RF-ERROR")) return { httpError: 500 };
      if (userText.includes("RF-EMPTY")) return { empty: true };
      return null;
    },
  });

  await waitForAppReady(page);
  await pickUsableSession(page);
  await shot(page, 910, "session-ready");

  // ===== RF-ERROR：上游 500 → [生成失败] 提示落会话 + composer 解禁 =====
  await sendMessage(page, "RF-ERROR 探针：触发上游错误");
  let last = await waitLastAssistant(page, "[生成失败]");
  await shot(page, 911, "error-notice-in-chat");
  const composer = page.locator('textarea[aria-label="消息输入"]');
  const errUnlocked = !(await composer.isDisabled().catch(() => true));
  record("RF-ERROR", last.includes("[生成失败]"), `提示命中=${last.includes("[生成失败]")} 尾部摘要=${last.slice(0, 60)}`);
  record("RF-UNLOCK-ERROR", errUnlocked, `composer disabled=${!errUnlocked}`);
  await composer.fill("失败后重发探针");
  await shot(page, 912, "composer-usable-after-error");

  // ===== RF-PERSIST：返回再重进，[生成失败] 仍在（落库而非易失） =====
  const bk = page.locator('button[aria-label="返回"]:visible').first();
  await bk.click();
  await page.waitForTimeout(900);
  await page.locator("#session-list li:visible").first().click();
  await page.waitForTimeout(1500);
  last = await waitLastAssistant(page, "[生成失败]");
  await shot(page, 913, "error-notice-after-reenter");
  record("RF-PERSIST", last.includes("[生成失败]"), `重进后尾部摘要=${last.slice(0, 60)}`);

  // ===== RF-RECOVER：失败后修改重发 → 正常回复到达（解锁完整闭环） =====
  await sendMessage(page, "RF-RECOVER 正常消息");
  last = await waitLastAssistant(page, "收到，短回复");
  await shot(page, 914, "recovered-normal-reply");
  record("RF-RECOVER", last.includes("收到，短回复"), `尾部摘要=${last.slice(0, 40)}`);

  // ===== RF-EMPTY：成功但空内容 → （本次生成无内容输出）占位 =====
  await sendMessage(page, "RF-EMPTY 探针：触发空回复");
  last = await waitLastAssistant(page, "（本次生成无内容输出）");
  await shot(page, 915, "empty-notice-in-chat");
  record("RF-EMPTY", last.includes("（本次生成无内容输出）"), `提示命中=${last.includes("（本次生成无内容输出）")} 尾部摘要=${last.slice(0, 60)}`);

  // ===== RF-UNLOCK-EMPTY：空回复后 composer 解禁、重发正常 =====
  const emptyUnlocked = !(await composer.isDisabled().catch(() => true));
  // 注意重发文案不能含「RF-EMPTY/RF-ERROR」关键词——replyFor 会再次命中失败分支
  await sendMessage(page, "空回复之后修改重发的正常消息");
  last = await waitLastAssistant(page, "收到，短回复");
  await shot(page, 916, "recovered-after-empty");
  record("RF-UNLOCK-EMPTY", emptyUnlocked && last.includes("收到，短回复"), `disabled=${!emptyUnlocked} 重发回复=${last.slice(0, 20)}`);

  console.log("SUMMARY", JSON.stringify(results));
  console.log("RF_ERRORS", errors.length, JSON.stringify(errors));
  const allPass = results.every((r) => r.pass);
  console.log(`ALL_PASS ${allPass}`);
  await shutdown(app, vite, mock);
  process.exit(allPass ? 0 : 1);
} catch (err) {
  console.error("CASE_CRASH", err);
  console.error("RF_ERRORS", errors.length, JSON.stringify(errors));
  await shutdown(app, vite);
  process.exit(2);
}
