// v1.5.20 修复批次：case-rollback-restore——删除文件后回滚消息，文件随回滚复现
// 流程：会话内（chat 面板 = session scope，正是 checkpoint 捕获域）新建文件并写入内容
// → 发一轮对话让 baseline checkpoint 捕获该文件 → 树上删除文件 → 对消息发起回滚
// → 断言文件重新出现在文件树、可打开且内容还原到 checkpoint 时点。
// PRD：docs/Iterations/vfs-rename-rollback-fixes-2026-09/bugs/rollback-restore-deleted-entry/prd.md
import {
  waitForAppReady, launchApp, shutdown, startMock, shot, sendMessage,
  openWorkspaceContextMenu, closeOverlays, pickUsableSession,
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

const FILE_NAME = "回滚复现.md";
const FILE_BODY = "回滚复现用正文内容：删除后回滚应当把我带回来。";

// 树上（chat 面板）定位指定文件名节点
const chatFileNode = (name) =>
  page.locator('.workspace-tree-panel[data-workspace-panel="chat"] .tree-node').filter({ hasText: name }).first();

// 右键树节点弹行菜单（带坐标右键，click({button}) 无坐标会点 (0,0)）
async function rightClickNode(node) {
  const box = await node.boundingBox();
  if (!box) throw new Error("树节点不可见，无法右键");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  const menu = page.locator("#workspace-context-menu");
  await menu.waitFor({ state: "visible", timeout: 5000 });
  return menu;
}

// 抓当前可见 toast 文本（3.2s 消失，动作后立即抓）
const toastText = () => page.evaluate(() =>
  document.querySelector(".shell-toast.is-visible .shell-toast__message")?.textContent
  ?? document.querySelector(".shell-toast.is-visible")?.textContent ?? null);

try {
  await waitForAppReady(page);
  await pickUsableSession(page);
  await closeOverlays(page);
  await sleep(600);

  // ===== Phase 1：chat 面板新建文件 + 写内容 + 保存 =====
  console.log("PHASE", "create-file");
  await openWorkspaceContextMenu(page);
  await sleep(600);
  await page.locator('[data-workspace-action="create-file"]').first().click();
  await sleep(800);
  await page.locator(".text-prompt-modal input").first().fill(FILE_NAME);
  await page.locator(".text-prompt-modal button").filter({ hasText: /^确定$|^创建$/ }).first().click();
  await sleep(1200);

  let node = chatFileNode(FILE_NAME);
  if (!(await node.count())) throw new Error(`${FILE_NAME} 未创建`);
  await node.click(); // 打开预览
  await sleep(1300);
  // 切编辑模式写正文并保存（Ctrl+S）
  await page.locator('[aria-label="预览模式"] button').filter({ hasText: "编辑" }).first().click();
  await sleep(800);
  const cm = page.locator(".cm-content").first();
  await cm.click();
  await page.keyboard.type(FILE_BODY, { delay: 2 });
  await page.keyboard.press("Control+s");
  await sleep(1000);
  const savedToast = await toastText();
  console.log("SAVE_TOAST", JSON.stringify(savedToast));
  await shot(page, "800", "file-created-saved");

  // ===== Phase 2：发一轮对话（baseline checkpoint 捕获该文件）=====
  console.log("PHASE", "checkpoint-msg");
  await sendMessage(page, "回滚复现引导：请记住当前工作区状态。");
  await sleep(1200);
  const msgCount1 = await page.evaluate(() => document.querySelectorAll(".chat-message").length);
  console.log("MSG_COUNT_AFTER_SEND", msgCount1);
  await shot(page, "801", "checkpoint-message-sent");

  // ===== Phase 3：删除文件 =====
  console.log("PHASE", "delete-file");
  node = chatFileNode(FILE_NAME);
  await rightClickNode(node);
  await sleep(500);
  await page.locator('[data-workspace-action="delete"]').first().click();
  await sleep(800);
  const delConfirmText = await page.evaluate(() => document.querySelector(".confirm-modal")?.textContent?.slice(0, 80) ?? null);
  console.log("DEL_CONFIRM", JSON.stringify(delConfirmText));
  await shot(page, "802", "delete-confirm");
  await page.locator(".confirm-modal button").filter({ hasText: /删除|确定/ }).first().click();
  await sleep(1400);
  const goneAfterDel = (await chatFileNode(FILE_NAME).count()) === 0;
  console.log("FILE_GONE_AFTER_DEL", goneAfterDel);
  await shot(page, "803", "file-deleted");
  record("RB-DEL", goneAfterDel, `删除后树上${goneAfterDel ? "已无该文件" : "仍存在该文件"}`);

  // ===== Phase 4：对消息发起回滚（删除前那轮对话的 assistant 回复）=====
  console.log("PHASE", "rollback");
  // 打开最后一条 assistant 消息的悬浮菜单（menu-btn 可能 hover 才可见，evaluate 直点兜底）
  const menuClicked = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll(".chat-message--assistant")].filter((m) => m.offsetParent);
    const last = msgs[msgs.length - 1];
    if (!last) return false;
    const btn = last.querySelector('button[aria-label="消息操作"]');
    if (!btn) return false;
    btn.click();
    return true;
  });
  console.log("MSG_MENU_CLICKED", menuClicked);
  await sleep(900);
  await shot(page, "804", "message-menu-open");
  await page.locator('[data-message-action="rollback"]').first().click();
  await sleep(900);
  // 回滚确认弹窗（rollback kind 的确认按钮文案「确定」）
  const rbConfirm = await page.evaluate(() => ({
    visible: (() => { const m = document.querySelector(".confirm-modal"); return !!m && !!m.offsetParent; })(),
    text: document.querySelector(".confirm-modal")?.textContent?.slice(0, 100) ?? null,
  }));
  console.log("ROLLBACK_CONFIRM", JSON.stringify(rbConfirm));
  await shot(page, "805", "rollback-confirm");
  await page.locator(".confirm-modal button").filter({ hasText: "确定" }).first().click();
  await sleep(1800);

  // ===== Phase 5：断言复现 =====
  console.log("PHASE", "assert-restore");
  // 轮询树刷新（回滚事务 + notifyWorkspaceMutated 去抖 100ms + 树 reload）
  let restored = false;
  for (let i = 0; i < 12; i++) {
    if ((await chatFileNode(FILE_NAME).count()) > 0) { restored = true; break; }
    await sleep(500);
  }
  const rbToast = await toastText();
  console.log("ROLLBACK_TOAST", JSON.stringify(rbToast));
  await shot(page, "806", "after-rollback");
  record("RB-RESTORE", restored, `回滚后树上${restored ? "文件复现" : "文件未复现"} toast=${JSON.stringify(rbToast)}`);

  // 复现后可打开且内容还原
  await step("RB-CONTENT", async () => {
    if (!restored) return record("RB-CONTENT", false, "文件未复现，跳过内容断言");
    const n2 = chatFileNode(FILE_NAME);
    await n2.click();
    await sleep(1400);
    const body = await page.evaluate(() => document.querySelector("#preview-body")?.textContent ?? "");
    const hasBody = body.includes(FILE_BODY.slice(0, 10));
    await shot(page, "807", "restored-file-opened");
    record("RB-CONTENT", hasBody, `预览正文${hasBody ? "含 checkpoint 时点内容" : "未还原：" + body.slice(0, 60)}`);
  });

  // ===== 汇总 =====
  await closeOverlays(page);
  await shot(page, "808", "done");
  console.log("SUMMARY", JSON.stringify(results));
  const allPass = results.every((r) => r.pass);
  console.log("ALL_PASS", allPass);
  if (!allPass) process.exitCode = 1;

} catch (e) {
  console.log("SCRIPT_ERROR", String(e).slice(0, 500));
  process.exitCode = 1;
  try { await page.screenshot({ path: "/tmp/rb-restore-err.png" }); } catch {}
}
await shutdown(app, vite, mock);
console.log("RB_RESTORE_DONE errors:", errors.length, JSON.stringify(errors.slice(0, 5)));
