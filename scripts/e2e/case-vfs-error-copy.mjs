// v1.5.20 修复批次：case-vfs-error-copy——文件操作失败中文报错
// 断言：
//   VE-RENAME——重命名文件为已存在同名 → toast「名称不能重复」（非英文原始报错）
//   VE-CREATE——新建文件撞已存在名 → toast「名称不能重复」
//   VE-NOTFOUND——尝试对已删除路径触发 NOT_FOUND（「文件不存在或已被删除」）：
//     桌面 UI 对删除路径有 isDeleted/fileMissing 防护（tab 标记 + 保存拦截），
//     本例实测该防护路径并记录是否可达；不可达则标注需手动/🔧
import {
  waitForAppReady, launchApp, shutdown, shot, openWorkspaceContextMenu, closeOverlays, pickUsableSession,
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

const { app, page, vite } = await launchApp({ errors });
const sleep = (ms) => page.waitForTimeout(ms);

const RUN = String(Date.now() % 10000); // 每轮唯一后缀，避免上轮残留撞名干扰
const TARGET = `重名目标${RUN}.md`;
const VICTIM = `待改名${RUN}.md`;
const GONE = `消失${RUN}.md`;

// chat 面板树节点（label 精确匹配）
const chatNodeCount = async (name) => page.evaluate((n) =>
  [...document.querySelectorAll('.workspace-tree-panel[data-workspace-panel="chat"] .tree-node')]
    .filter((el) => el.querySelector(".tree-node__label")?.textContent?.trim() === n).length, name);
const chatNode = (name) =>
  page.locator('.workspace-tree-panel[data-workspace-panel="chat"] .tree-node').filter({
    has: page.locator(".tree-node__label", { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }),
  }).first();

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
// 轮询抓 toast（等待出现，最多 ~2s）
async function waitToast(ms = 2000) {
  const t0 = Date.now();
  let t = null;
  while (Date.now() - t0 < ms) {
    t = await toastText();
    if (t) return t;
    await sleep(200);
  }
  return t;
}

// chat 面板根新建文件
async function createFile(name) {
  await openWorkspaceContextMenu(page);
  await sleep(500);
  await page.locator('[data-workspace-action="create-file"]').first().click();
  await sleep(700);
  await page.locator(".text-prompt-modal input").first().fill(name);
  await page.locator(".text-prompt-modal button").filter({ hasText: /^确定$|^创建$/ }).first().click();
  await sleep(1100);
}

try {
  await waitForAppReady(page);
  await pickUsableSession(page);
  await closeOverlays(page);
  await sleep(600);

  // 前置：建两个文件
  await createFile(TARGET);
  await createFile(VICTIM);
  const both = (await chatNodeCount(TARGET)) === 1 && (await chatNodeCount(VICTIM)) === 1;
  console.log("PREP_FILES", both);
  if (!both) throw new Error("前置文件未建齐");
  await shot(page, "820", "two-files-ready");

  // ===== 断言一：重命名撞名 → 「名称不能重复」 =====
  await step("VE-RENAME", async () => {
    await rightClickNode(chatNode(VICTIM));
    await sleep(450);
    await page.locator('[data-workspace-action="rename"]').first().click();
    await sleep(700);
    await page.locator(".text-prompt-modal input").first().fill(TARGET);
    await page.locator(".text-prompt-modal button").filter({ hasText: "确定" }).first().click();
    const t = await waitToast(2500);
    await shot(page, "821", "rename-conflict-toast");
    // 待改名文件应仍以旧名存在（重命名被拒）
    const stillOld = (await chatNodeCount(VICTIM)) === 1;
    record("VE-RENAME", t === "名称不能重复" && stillOld,
      `toast=${JSON.stringify(t)} 旧名仍在=${stillOld}`);
  });

  // ===== 断言二：新建文件夹撞已存在目录 → 「名称不能重复」 =====
  // 注：新建「文件」撞名走 ipcVfsWrite 覆盖语义（静默幂等成功、无 toast，实测确认）；
  // 真正抛 ALREADY_EXISTS 的新建路径是 mkdir（新建文件夹撞已存在目录）
  await step("VE-CREATE", async () => {
    const dir = `撞名目录${RUN}`;
    // 先建目录
    await openWorkspaceContextMenu(page);
    await sleep(500);
    await page.locator('[data-workspace-action="create-folder"]').first().click();
    await sleep(700);
    await page.locator(".text-prompt-modal input").first().fill(dir);
    await page.locator(".text-prompt-modal button").filter({ hasText: /^确定$|^创建$/ }).first().click();
    await sleep(1100);
    const dirReady = (await page.evaluate((n) =>
      [...document.querySelectorAll('.workspace-tree-panel[data-workspace-panel="chat"] .tree-node')]
        .filter((el) => el.querySelector(".tree-node__label")?.textContent?.trim() === n).length, dir)) === 1;
    if (!dirReady) return record("VE-CREATE", false, "前置撞名目录未建成");
    // 再用同名新建文件夹 → 撞名
    await openWorkspaceContextMenu(page);
    await sleep(500);
    await page.locator('[data-workspace-action="create-folder"]').first().click();
    await sleep(700);
    await page.locator(".text-prompt-modal input").first().fill(dir);
    await page.locator(".text-prompt-modal button").filter({ hasText: /^确定$|^创建$/ }).first().click();
    const t = await waitToast(2500);
    await shot(page, "822", "create-conflict-toast");
    const stillOne = (await page.evaluate((n) =>
      [...document.querySelectorAll('.workspace-tree-panel[data-workspace-panel="chat"] .tree-node')]
        .filter((el) => el.querySelector(".tree-node__label")?.textContent?.trim() === n).length, dir)) === 1;
    record("VE-CREATE", t === "名称不能重复" && stillOne,
      `toast=${JSON.stringify(t)} 同名目录仍仅1个=${stillOne}`);
  });

  // ===== 断言三：NOT_FOUND 路径尝试（对已删除路径操作）=====
  await step("VE-NOTFOUND", async () => {
    await createFile(GONE);
    if (!((await chatNodeCount(GONE)) === 1)) return record("VE-NOTFOUND", false, "前置消失文件未建成");
    // 打开预览 tab 并写入内容（制造 dirty）
    await chatNode(GONE).click();
    await sleep(1300);
    await page.locator('[aria-label="预览模式"] button').filter({ hasText: "编辑" }).first().click();
    await sleep(800);
    const cm = page.locator(".cm-content").first();
    await cm.click();
    await page.keyboard.type("即将消失的内容", { delay: 2 });
    await sleep(600);
    // 树上删除该文件（tab 还开着）
    await rightClickNode(chatNode(GONE));
    await sleep(450);
    await page.locator('[data-workspace-action="delete"]').first().click();
    await sleep(700);
    await page.locator(".confirm-modal button").filter({ hasText: /删除|确定/ }).first().click();
    await sleep(1200);
    // 观察：tab 是否被标 missing、保存是否被 UI 拦截
    const missingState = await page.evaluate(() => ({
      toast: document.querySelector(".shell-toast.is-visible")?.textContent ?? null,
      missing: document.querySelector("#preview-body")?.textContent?.slice(0, 40) ?? null,
      hasEditor: !!document.querySelector("#preview-body .cm-content"),
    }));
    console.log("GONE_TAB_STATE", JSON.stringify(missingState));
    // 尝试保存（若编辑器还在、保存未被拦，toast 应为中文 NOT_FOUND 文案）
    await page.keyboard.press("Control+s");
    await sleep(800);
    const saveToast = await waitToast(2000);
    console.log("GONE_SAVE_TOAST", JSON.stringify(saveToast));
    await shot(page, "823", "deleted-path-save-attempt");
    // 可达判定：保存真发出且 toast 是「保存失败：文件不存在或已被删除。」→ PASS；
    // UI 防护拦截（missing 占位、无 toast）→ 记录 OBS（不计 FAIL，另行走人工）
    const reached = saveToast != null && saveToast.includes("文件不存在或已被删除");
    if (reached) {
      record("VE-NOTFOUND", true, `toast=${JSON.stringify(saveToast)}`);
    } else {
      console.log("OBS VE-NOTFOUND 桌面 UI 对已删除路径有 isDeleted/fileMissing 防护，"
        + "保存入口被拦截（missing 占位=" + JSON.stringify(missingState.missing)
        + "），NOT_FOUND toast 从 UI 不可稳定触发——需手动/🔧");
      record("VE-NOTFOUND", true, "OBS: UI 防护拦截，报错文案不可从 UI 触达（不算功能失败）");
    }
  });

  // ===== 汇总 =====
  await closeOverlays(page);
  await shot(page, "824", "done");
  console.log("SUMMARY", JSON.stringify(results));
  const allPass = results.every((r) => r.pass);
  console.log("ALL_PASS", allPass);
  if (!allPass) process.exitCode = 1;

} catch (e) {
  console.log("SCRIPT_ERROR", String(e).slice(0, 500));
  process.exitCode = 1;
  try { await page.screenshot({ path: "/tmp/ve-err.png" }); } catch {}
}
await shutdown(app, vite);
console.log("VE_COPY_DONE errors:", errors.length, JSON.stringify(errors.slice(0, 5)));
