// 公共库：worktree 桌面端 e2e 启动器 + mock server + 工具（资产版：住仓库 scripts/e2e，重启不丢）
import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

// 路径全部基于脚本自身位置动态解析（lib.mjs 位于 <worktree根>/scripts/e2e/），
// 消除对旧 worktree 绝对路径的硬编码——e2e 资产拷到任意 worktree 都能直接跑
const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(E2E_DIR, "..", "..");
export const DESKTOP = path.join(ROOT, "apps/desktop");
export const OUT = path.join(E2E_DIR, "out");
export const DATA = path.join(E2E_DIR, "data");
const ELECTRON_BIN = path.join(ROOT, "node_modules", "electron", "dist", "electron");
export const MOCK_PORT = 18099;

export async function startMock({ slow = false } = {}) {
  const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
  const mock = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (req.url?.includes("/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: [{ id: "glm-4.7-flash" }, { id: "glm-4.7-air" }, { id: "glm-5.3" }] }));
        return;
      }
      const cb = (delta) => ({ id: "m", object: "chat.completion.chunk", created: 0, model: "glm-regression-test", choices: [{ index: 0, delta, finish_reason: null }] });
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(sse(cb({ role: "assistant", content: "" })));
      if (slow) {
        let i = 0;
        const parts = Array.from({ length: 40 }, (_, k) => `第${k + 1}段内容。`);
        const timer = setInterval(() => {
          if (i >= parts.length) { clearInterval(timer); res.write(sse({ ...cb({}), choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 6, total_tokens: 56 } })); res.write("data: [DONE]\n\n"); res.end(); return; }
          res.write(sse(cb({ content: parts[i] }))); i++;
        }, 300);
      } else {
        res.write(sse(cb({ content: "收到，短回复。" })));
        res.write(sse({ ...cb({}), choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 8, total_tokens: 108 } }));
        res.write("data: [DONE]\n\n");
        res.end();
      }
    });
  });
  await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));
  return mock;
}

function waitForPort(port, host, timeoutMs) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    (function tryOnce() {
      const s = net.connect({ port, host }, () => { s.destroy(); resolve(); });
      s.on("error", () => { s.destroy(); if (Date.now() - t0 > timeoutMs) return reject(new Error("port timeout")); setTimeout(tryOnce, 300); });
    })();
  });
}

// 单次探测端口是否已有响应（连接成功即通，不重试）
function probePort(port, host) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host }, () => { s.destroy(); resolve(true); });
    s.on("error", () => { s.destroy(); resolve(false); });
  });
}

// 跨进程 vite 复用：本进程 spawn 的 vite 才记在 ownVite，其余情形（端口已通、复用
// 前一个脚本起的 vite）为 null——清理责任见 shutdown/shutdownVite 的注释
let ownVite = null;

// 进程退出兜底：只杀自己 spawn 的 vite（ownVite），复用的不动。exit 回调里只能
// 同步操作，process.kill(-pid, SIGKILL) 是同步的，可用。防脚本异常路径泄漏孤儿 vite
process.on("exit", () => {
  if (ownVite) { try { process.kill(-ownVite.pid, "SIGKILL"); } catch {} }
});

// 彻底清场：杀本 worktree 路径前缀匹配的 vite（带 ROOT 前缀防误杀并行 worktree）。
// 供序列 runner（run-all）末尾调用——各 case 的 shutdown 已不管 vite，末尾脚本
// 正常退出时只杀自己的 ownVite，首个脚本起的 vite 要靠这个 pkill 兜底回收
export function shutdownVite() {
  try { execSync(`pkill -9 -f "${ROOT}/node_modules/.bin/vite"`, { stdio: "ignore" }); } catch {}
}

export async function launchApp({ errors = null } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(DATA, { recursive: true });
  // vite 跨进程复用：5173 已有响应（序列里前一个脚本起的还活着）则直接复用，不 spawn、
  // 不纳入本进程清理责任（ownVite 保持 null，exit 兜底不会杀它）；只有单跑（端口空）才自起
  // 自关。序列里首个脚本起 vite，后续 7 个复用，每轮省一次 vite 启动等待+退出回收
  let vite = null;
  if (await probePort(5173, "127.0.0.1")) {
    console.log("VITE_REUSE", "5173 已有响应，复用现有 vite");
  } else {
    vite = spawn("npx", ["vite"], { cwd: DESKTOP, stdio: ["ignore", "pipe", "pipe"], detached: true });
    ownVite = vite;
    await waitForPort(5173, "127.0.0.1", 60000);
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.DISPLAY = env.DISPLAY || ":0";
  env.NOVEL_MASTER_DB = path.join(DATA, "novel.db");
  // 更新检查 env 短路（apps/desktop checkForUpdates 入口消费）：e2e 环境的 GitHub fetch
  // 立即失败，免去每次启动 10s 超时等待 + autoCheck 弹窗判定窗口
  env.NOVEL_MASTER_DISABLE_UPDATE_CHECK = "1";
  // electron 启动失败（ELECTRON_BIN 路径错误等）时先回收 vite 进程组再抛——孤儿 vite 占住 5173，
  // 会让下一次 launchApp 的复用探测误判「端口已就绪」而连锁挂起；
  // mock 进程由调用方管理（startMock 独立拉起），本函数失败不负责回收 mock
  let app;
  try {
    app = await _electron.launch({
      executablePath: ELECTRON_BIN,
      args: ["."], cwd: DESKTOP, env,
    });
  } catch (e) {
    // 只回收自己 spawn 的 vite（复用场景 vite=null 无清理责任），防孤儿 vite 占住 5173
    if (vite) { try { process.kill(-vite.pid, "SIGKILL"); } catch {} }
    ownVite = null;
    throw e;
  }
  const page = await app.firstWindow();
  await page.on("dialog", (d) => { d.dismiss().catch(() => {}); });
  if (errors) {
    page.on("pageerror", (err) => errors.push(String(err).slice(0, 200)));
    page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("Electron Security Warning") && !m.text().includes("Insecure Content")) errors.push(("c:" + m.text()).slice(0, 200)); });
  }
  // 版本弹窗兜底：autoCheck 在 bootstrap ready 2s 后弹「版本检查」结果遮罩
  // （snooze 写库 24h，清库即失效——每轮 bootstrap 后首跑必弹），不点掉会挡全屏操作 30s 超时；
  // 窗口 3s：env 短路（NOVEL_MASTER_DISABLE_UPDATE_CHECK=1）后主进程 fetch 立即失败，
  // 「版本检查」遮罩理论上不会再弹，这里纯防漏网兑底；弹出则优先「今日不再提醒」
  await dismissUpdatePrompt(page, 3000);
  return { app, page, vite };
}

// 版本弹窗兜底：有界轮询等待「版本检查」结果遮罩出现（env 短路后 launchApp 传 3s 纯防漏网，
// 定点调用方自选窗口；限定标题「版本检查」避免误伤同结构的其它 overlay 弹窗）；
// 出现则优先点「今日不再提醒」（写库 snooze 24h，同库后续脚本不再弹），无则退回「关闭」。
// 检测到并处理返回 true，窗口耗尽返回 false
export async function dismissUpdatePrompt(page, timeoutMs = 8000) {
  const overlay = page.locator('.text-prompt-overlay .update-modal:has-text("版本检查")');
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await overlay.count()) {
      const snooze = overlay.locator("button").filter({ hasText: "今日不再提醒" }).first();
      if (await snooze.count()) {
        await snooze.click().catch(() => {});
      } else {
        await overlay.locator("button").filter({ hasText: "关闭" }).first().click().catch(() => {});
      }
      await overlay.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
      return true;
    }
    await page.waitForTimeout(300);
  }
  return false;
}

// 工作区右键上下文菜单：取 .workspace-trees boundingBox 中心右键（替代固定 640,300——窗口
// 尺寸/布局变化下固定坐标会点空），等待 #workspace-context-menu 出现后返回其 locator
export async function openWorkspaceContextMenu(page) {
  const trees = page.locator(".workspace-trees").first();
  const box = await trees.boundingBox();
  if (!box) throw new Error("workspace-trees 不可见，无法右键打开工作区菜单");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  const menu = page.locator("#workspace-context-menu");
  await menu.waitFor({ state: "visible", timeout: 5000 });
  return menu;
}

// case 正常收尾：只关 electron + mock，不管 vite——序列里首个脚本起的 vite 要留给后续
// 脚本复用；自己 spawn 的 vite 由模块级 exit 兜底在脚本退出时回收（单跑场景自起自关）。
// vite 参数保留只为兼容既有调用点，已不参与清理；需要彻底清场用 shutdownVite()
export async function shutdown(app, vite = null, mock = null) {
  try { await app.close(); } catch {}
  if (mock) mock.close();
}

export async function shot(page, id, name, ms = 900) {
  await page.waitForTimeout(ms);
  await page.screenshot({ path: path.join(OUT, `${id}-${name}.png`) });
  console.log(`STEP ${id} ${name}`);
}

export async function goToProjects(page) {
  for (let i = 0; i < 4; i++) {
    const vis = await page.evaluate(() => [...document.querySelectorAll(".chat-nav-view")].filter((v) => !v.hidden).map((v) => v.getAttribute("data-nav-view")));
    if (vis.includes("projects")) return true;
    const bk = page.locator('button[aria-label="返回"]:visible').first();
    if (await bk.count()) { await bk.click(); await page.waitForTimeout(600); } else break;
  }
  const vis2 = await page.evaluate(() => [...document.querySelectorAll(".chat-nav-view")].filter((v) => !v.hidden).map((v) => v.getAttribute("data-nav-view")));
  return vis2.includes("projects");
}

export async function closeOverlays(page) {
  for (let i = 0; i < 6; i++) {
    const any = await page.evaluate(() => !!document.querySelector(".session-detail-drawer__backdrop, .picker-modal__backdrop, .file-ref-picker__backdrop, .picker-modal__panel, .session-detail-drawer:not([hidden])"));
    if (!any) return;
    const closeBtn = page.locator('[data-session-detail-action="close"]');
    if (await closeBtn.count()) { await closeBtn.first().click().catch(() => {}); await page.waitForTimeout(500); continue; }
    const bd = page.locator(".file-ref-picker__backdrop, .picker-modal__backdrop").first();
    if (await bd.count()) { await bd.click({ force: true }).catch(() => {}); await page.waitForTimeout(400); continue; }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(350);
  }
}

// 发消息并等 run 收敛（发送按钮 label 先离开「发送」再回归）
// 单发结构：disabled 分支只 force click 一次；enabled 分支只 fill+press 一次——
// 旧版 disabled 分支 force click 后再补 fill+press 会连发两条，第二条天然不带批注（D-15 误报根因）
export async function sendMessage(page, text) {
  const composer = page.locator('textarea[aria-label="消息输入"]');
  // 轮询等 composer 解禁（绑模型后 IPC 回写有延迟），最多 10s
  for (let i = 0; i < 20; i++) {
    if (!(await composer.isDisabled().catch(() => true))) break;
    await page.waitForTimeout(500);
  }
  if (await composer.isDisabled().catch(() => true)) {
    await page.locator('button[aria-label="发送"]').first().click({ force: true });
  } else {
    await composer.fill(text);
    await composer.press("Control+Enter");
  }
  await waitRunSettled(page);
}

// 两段式有界等待 run 收敛：
// ① 离开段 5s 上限——runAgent 首句 await ipcPromptAgentMeta（ChatComposer.tsx）先于 beginUiRun()，
//    发送瞬间 label 仍为「发送」，若首查即判「已回归」会零等待假收敛，必须先观察到它离开；
// ② 回归段 15s 上限——slow mock 分段流式（间隔 300ms×40 段）一轮续跑可达 ~12s，固定短等待会与后续步骤竞态
export async function waitRunSettled(page) {
  const label = () =>
    page.locator('button[aria-label="发送"], button[aria-label="停止"]').first().getAttribute("aria-label").catch(() => null);
  // 两段超时不再静默返回：warn 留痕（带最终 label 值）——发送失败/未收敛至少可见，不再吞成绿
  const tLeave = Date.now();
  let left = false;
  while (Date.now() - tLeave < 5000) {
    if ((await label()) !== "发送") { left = true; break; }
    await page.waitForTimeout(200);
  }
  if (!left) console.warn(`waitRunSettled: 离开段超时（5s 未见 label 离开「发送」，最终 label=${await label()}）——疑似发送失败`);
  const tBack = Date.now();
  let back = false;
  while (Date.now() - tBack < 15000) {
    if ((await label()) === "发送") { back = true; break; }
    await page.waitForTimeout(300);
  }
  if (!back) console.warn(`waitRunSettled: 回归段超时（15s 未见 label 回归「发送」，最终 label=${await label()}）——run 未收敛`);
}

// 会话自足选择：在会话列表页逐个尝试会话直至 composer 可用（未绑模型/禁用态的 composer 不可用）；
// 全不可用时进第一个会话自行绑定模型（B4 同款抽屉流程：session-actions 抽屉→切换大模型→picker 选第二项）。
// 调用方需先导航至目标项目的会话列表页——全量序列里上游 case（如 session-mgmt 删除断言）可能删光绑模型的会话
export async function pickUsableSession(page) {
  // 前置：已停妥可用会话（composer 在且可用）则直接返回（续库单跑/全量序列恢复路径）
  {
    const c0 = page.locator('textarea[aria-label="消息输入"]');
    if ((await c0.count()) && !(await c0.isDisabled().catch(() => true))) {
      console.log("PICK_SKIP", "current session usable");
      return;
    }
    // composer 不可用且处于会话内：先返回到会话列表
    if (await c0.count()) {
      const bk = page.locator('button[aria-label="返回"]:visible').first();
      if (await bk.count()) { await bk.click(); await page.waitForTimeout(800); }
    }
  }
  // 回到回归项目A 的会话列表（可能在项目列表/项目内任意状态）
  await goToProjects(page);
  await page.locator("li:visible").filter({ hasText: "回归项目A" }).first().click();
  await page.waitForTimeout(700);
  const rows0 = page.locator("#session-list li:visible");
  const total = await rows0.count();
  for (let i = 0; i < total; i++) {
    const rows = page.locator("#session-list li:visible");
    if (i >= (await rows.count())) break;
    await rows.nth(i).click();
    await page.waitForTimeout(1100);
    const c = page.locator('textarea[aria-label="消息输入"]');
    const ok = (await c.count()) && !(await c.isDisabled().catch(() => true));
    console.log("PICK_TRY", i, ok ? "OK" : "skip");
    if (ok) return;
    await page.locator('button[aria-label="返回"]:visible').first().click();
    await page.waitForTimeout(600);
  }
  console.log("NO_READY_SESSION——自足绑模型");
  const rows = page.locator("#session-list li:visible");
  if ((await rows.count()) === 0) throw new Error("no session to bind model");
  await rows.first().click();
  await page.waitForTimeout(1200);
  await page.locator('[data-action="open-session-actions"]').first().click();
  await page.waitForTimeout(900);
  await page.locator('[aria-label^="切换大模型"]').first().click();
  await page.waitForTimeout(800);
  await page.locator(".picker-modal__panel li:visible").nth(1).click();
  await page.waitForTimeout(800);
  await closeOverlays(page);
  await page.waitForTimeout(500);
  const c = page.locator('textarea[aria-label="消息输入"]');
  if (!(await c.count()) || (await c.isDisabled().catch(() => true))) throw new Error("bind model failed");
  console.log("SELF_BOUND_OK");
}

// 附件断言：带超时的重试式探测（≤30 次×500ms）——先等「最近一条 user 消息」文本匹配 needle
// （确认落库渲染的是本条而非发送前的旧消息），再验该消息的批注附件分组卡片（MessageAttachmentGroupCard）。
// 超时不抛异常，返回 {matched, hasAttach, detail} 由调用方收口断言/记录
export async function assertLastUserAttach(page, needle) {
  let assert = { matched: false, hasAttach: false, detail: "no-attempt" };
  for (let i = 0; i < 30 && !assert.matched; i++) {
    assert = await page.evaluate((needle) => {
      const msgs = [...document.querySelectorAll(".chat-message--user")].filter((m) => m.offsetParent);
      const last = msgs[msgs.length - 1] ?? null;
      if (!last) return { matched: false, hasAttach: false, detail: "no-user-msg" };
      const text = last.querySelector(".chat-message__body")?.textContent ?? "";
      if (!text.includes(needle)) return { matched: false, hasAttach: false, detail: "stale:" + text.slice(0, 40) };
      const grp = last.querySelector(".chat-message__attach-group");
      return { matched: true, hasAttach: !!grp, detail: grp?.querySelector("summary")?.textContent ?? "no-attach-group" };
    }, needle);
    if (!assert.matched) await page.waitForTimeout(500);
  }
  return assert;
}
