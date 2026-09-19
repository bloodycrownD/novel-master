// v1.5.16 批次 B3：case-chat-file-link——聊天消息 markdown 文件链接应用内打开
// 断言：
//   FL-CHAT——相对路径链接指向聊天工作区已有文件（中文目录/文件名）→ 点击 →
//             预览 tab 激活显示该文件 + 正文标记可见（chat 域探测命中）
//   FL-PROJ——链接指向仅项目工作区存在的文件 → 点击 → 预览打开（chat 域 miss
//             后 session 域 fallback 命中，探测顺序 chat→session）
//   FL-NOTFOUND——链接指向双域都不存在的超长中文路径 → toast「/一个.../报告.md 不存在」
//             （elideChatLinkPath 中间省略）+ 预览 tab 不增加
//   FL-HTTP——http(s) 链接点击后窗口不导航（page.url 仍是 vite dev 地址）
//   FL-STAY——同一次点击后界面仍完整（chat-rail/composer 在）——v1.5.16 修复项
//             「点击消息内链接不再把整个窗口带走」的独立断言
// 预期依据：CHANGELOG v1.5.16 + renderer chat-link-route.ts / resolve-chat-link-target.ts
//   （探测顺序先 chat 后 session；not-found 文案 = elideChatLinkPath(path) + " 不存在"）
import {
  waitForAppReady, launchApp, shutdown, startMock, shot, goToProjects,
  sendMessage, pickUsableSession, waitForToast,
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

// mock 按用户消息关键词返回带 markdown 链接的回复（lib.mjs B3 增量 replyFor）
const REPLY_MAP = {
  "FL-CHAT": "[查看报告](测试资料/报告.md)",
  "FL-PROJ": "[项目文档](项目共享.md)",
  "FL-NOTFOUND": "[幽灵路径](一个/很深/很深/很深/的/路径/报告.md)",
  "FL-HTTP": "[外部链接](https://e2e-external.invalid/fl-probe)",
};
const mock = await startMock({
  replyFor: (userText) => {
    for (const [key, reply] of Object.entries(REPLY_MAP)) {
      if (userText && userText.includes(key)) return reply;
    }
    return null;
  },
});
const { app, page, vite } = await launchApp({ errors });
const sleep = (ms) => page.waitForTimeout(ms);

// 命名陷阱（chat-link-route 头注）：UI 面板 data-workspace-panel="chat"（聊天工作区）
// = core session 域；"session" 面板（会话工作区）= core project 域（项目母本）
const CHAT_PANEL = '.workspace-tree-panel[data-workspace-panel="chat"]';
const SESS_PANEL = '.workspace-tree-panel[data-workspace-panel="session"]';

const nodeCount = async (panel, name) => page.evaluate(({ p, n }) =>
  [...document.querySelectorAll(p + " .tree-node")]
    .filter((el) => el.querySelector(".tree-node__label")?.textContent?.trim() === n).length, { p: panel, n: name });

async function rightClickNode(panel, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const node = page.locator(panel + " .tree-node").filter({
    has: page.locator(".tree-node__label", { hasText: new RegExp(`^${esc}$`) }),
  }).first();
  await node.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await sleep(200);
  const box = await node.boundingBox();
  if (!box) throw new Error("树节点不可见: " + name);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  const menu = page.locator("#workspace-context-menu");
  await menu.waitFor({ state: "visible", timeout: 5000 });
  return menu;
}
const menuAction = (action) =>
  page.locator(`[data-workspace-action="${action}"]`).first().evaluate((el) => el.click());

async function createFolder(panel, name) {
  await rightClickNode(panel, "/");
  await sleep(500);
  await menuAction("create-folder");
  await sleep(700);
  await page.locator(".text-prompt-modal input").first().fill(name);
  await page.locator(".text-prompt-modal button").filter({ hasText: /^确定$|^创建$/ }).first().click();
  await sleep(1100);
}

async function createFileIn(panel, parent, name) {
  await rightClickNode(panel, parent);
  await sleep(450);
  await menuAction("create-file");
  await sleep(700);
  await page.locator(".text-prompt-modal input").first().fill(name);
  await page.locator(".text-prompt-modal button").filter({ hasText: /^确定$|^创建$/ }).first().click();
  await sleep(1000);
}

// 打开预览 → 切编辑 → CodeMirror 写正文 → Ctrl+S（bootstrap B6 同款流程）
async function writeBody(panel, fileName, body) {
  const node = page.locator(panel + " .tree-node").filter({ hasText: fileName }).first();
  await node.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await node.click();
  await sleep(900);
  await page.locator('[aria-label="预览模式"] button').filter({ hasText: "编辑" }).first().click();
  await sleep(800);
  const cm = page.locator(".cm-content").first();
  if (!(await cm.count())) throw new Error("编辑器未打开: " + fileName);
  await cm.click();
  await page.keyboard.type(body, { delay: 3 });
  await page.keyboard.press("Control+s");
  await sleep(900);
  // 写完切回预览模式，后续断言统一读预览正文
  await page.locator('[aria-label="预览模式"] button').filter({ hasText: "预览" }).first().click();
  await sleep(600);
}

// 等最后一条 assistant 消息渲染出 data-chat-link 链接（含 needle 文案），返回其 locator
async function waitLink(text) {
  const link = page.locator(".chat-message--assistant a[data-chat-link]").filter({ hasText: text }).last();
  await link.waitFor({ state: "visible", timeout: 8000 });
  return link;
}

// 预览状态快照：激活 tab label + 预览正文文本 + tab 总数
const previewState = () => page.evaluate(() => ({
  activeTab: document.querySelector(".preview-editor-tabs__tab.is-active .preview-editor-tabs__label")?.textContent?.trim() ?? null,
  tabs: document.querySelectorAll(".preview-editor-tabs__tab").length,
  body: document.querySelector("#preview-body")?.textContent ?? "",
}));

// 轮询等预览就绪：激活 tab = fileName 且正文含 needle（VFS read + markdown
// 渲染在 dev 模式下有延迟，固定 sleep 会与加载竞态）；超时返回最后一次快照
async function waitForPreview(fileName, needle, timeoutMs = 8000) {
  const t0 = Date.now();
  let st = await previewState();
  while (Date.now() - t0 < timeoutMs) {
    st = await previewState();
    if (st.activeTab === fileName && st.body.includes(needle)) return st;
    await page.waitForTimeout(300);
  }
  return st;
}

try {
  await waitForAppReady(page);

  // ===== 前置 1：项目工作区（session 面板）建 FL-PROJ 目标文件 =====
  console.log("PHASE", "setup-proj-file");
  await goToProjects(page);
  await page.locator("li:visible").filter({ hasText: "回归项目A" }).first().click();
  await sleep(1000);
  await createFileIn(SESS_PANEL, "/", "项目共享.md");
  if (!((await nodeCount(SESS_PANEL, "项目共享.md")) > 0)) throw new Error("项目共享.md 未创建");
  await writeBody(SESS_PANEL, "项目共享.md", "FL-PROJ 项目工作区正文标记。\n");
  await shot(page, "880", "proj-file-created");

  // ===== 前置 2：进会话（chat 面板激活），聊天工作区建中文目录/文件 =====
  console.log("PHASE", "setup-chat-file");
  await pickUsableSession(page);
  await shot(page, "881", "session-entered");
  await createFolder(CHAT_PANEL, "测试资料");
  if (!((await nodeCount(CHAT_PANEL, "测试资料")) > 0)) throw new Error("测试资料 目录未创建");
  await createFileIn(CHAT_PANEL, "测试资料", "报告.md");
  if (!((await nodeCount(CHAT_PANEL, "报告.md")) > 0)) throw new Error("报告.md 未创建");
  await writeBody(CHAT_PANEL, "报告.md", "FL-CHAT 聊天工作区正文标记。\n");
  await shot(page, "882", "chat-file-created");

  // ===== FL-CHAT：相对路径链接 → 聊天工作区文件预览 =====
  console.log("PHASE", "fl-chat");
  await step("FL-CHAT", async () => {
    await sendMessage(page, "请给我 FL-CHAT 链接");
    const link = await waitLink("查看报告");
    await shot(page, "883", "fl-chat-link-rendered");
    await link.click();
    const st = await waitForPreview("报告.md", "FL-CHAT 聊天工作区正文标记");
    await shot(page, "884", "fl-chat-preview-open");
    record("FL-CHAT",
      st.activeTab === "报告.md" && st.body.includes("FL-CHAT 聊天工作区正文标记"),
      `tab=${st.activeTab} 正文命中=${st.body.includes("FL-CHAT 聊天工作区正文标记")}`);
  });

  // ===== FL-PROJ：仅项目工作区存在的文件 → session 域 fallback 命中 =====
  console.log("PHASE", "fl-proj");
  await step("FL-PROJ", async () => {
    await sendMessage(page, "请给我 FL-PROJ 链接");
    const link = await waitLink("项目文档");
    await link.click();
    const st = await waitForPreview("项目共享.md", "FL-PROJ 项目工作区正文标记");
    await shot(page, "885", "fl-proj-preview-open");
    record("FL-PROJ",
      st.activeTab === "项目共享.md" && st.body.includes("FL-PROJ 项目工作区正文标记"),
      `tab=${st.activeTab} 正文命中=${st.body.includes("FL-PROJ 项目工作区正文标记")}`);
  });

  // ===== FL-NOTFOUND：双域未命中的超长中文路径 → toast 省略提示 =====
  console.log("PHASE", "fl-notfound");
  await step("FL-NOTFOUND", async () => {
    const tabsBefore = (await previewState()).tabs;
    await sendMessage(page, "请给我 FL-NOTFOUND 链接");
    const link = await waitLink("幽灵路径");
    await link.click();
    const toast = await waitForToast(page, "不存在");
    // toast 生命期 ~3.2s：命中即零延迟直拍（shot 默认 900ms 等待会把 toast 熬过窗）
    await shot(page, "886", "fl-notfound-toast", 0);
    const tabsAfter = (await previewState()).tabs;
    record("FL-NOTFOUND",
      toast === "/一个.../报告.md 不存在" && tabsAfter === tabsBefore,
      `toast=${JSON.stringify(toast)} tabs ${tabsBefore}→${tabsAfter}`);
  });

  // ===== FL-HTTP + FL-STAY：http 链接外跳，窗口不被带走 =====
  console.log("PHASE", "fl-http");
  await step("FL-HTTP", async () => {
    const urlBefore = page.url();
    await sendMessage(page, "请给我 FL-HTTP 链接");
    const link = await waitLink("外部链接");
    await link.click();
    await sleep(1800); // 给可能的导航留时间（若回归，此处窗口早已跳走）
    const urlAfter = page.url();
    await shot(page, "887", "fl-http-after-click");
    const intact = await page.evaluate(() => ({
      rail: !!document.querySelector("#chat-rail"),
      composer: !!document.querySelector('textarea[aria-label="消息输入"]'),
    }));
    record("FL-HTTP", urlAfter === urlBefore,
      `url ${urlBefore} → ${urlAfter}`);
    record("FL-STAY", intact.rail && intact.composer,
      `rail=${intact.rail} composer=${intact.composer}`);
  });

  // ===== 汇总 =====
  console.log("SUMMARY", JSON.stringify(results));
  const allPass = results.every((r) => r.pass);
  console.log("ALL_PASS", allPass);
  if (!allPass) process.exitCode = 1;

} catch (e) {
  console.log("SCRIPT_ERROR", String(e).slice(0, 500));
  process.exitCode = 1;
  try { await page.screenshot({ path: "/tmp/fl-err.png" }); } catch {}
}
await shutdown(app, vite, mock);
console.log("FL_DONE errors:", errors.length, JSON.stringify(errors.slice(0, 5)));
