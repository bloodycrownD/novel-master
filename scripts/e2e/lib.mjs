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

export async function launchApp({ errors = null } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(DATA, { recursive: true });
  const vite = spawn("npx", ["vite"], { cwd: DESKTOP, stdio: ["ignore", "pipe", "pipe"], detached: true });
  await waitForPort(5173, "127.0.0.1", 60000);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.DISPLAY = env.DISPLAY || ":0";
  env.NOVEL_MASTER_DB = path.join(DATA, "novel.db");
  const app = await _electron.launch({
    executablePath: ELECTRON_BIN,
    args: ["."], cwd: DESKTOP, env,
  });
  const page = await app.firstWindow();
  await page.on("dialog", (d) => { d.dismiss().catch(() => {}); });
  if (errors) {
    page.on("pageerror", (err) => errors.push(String(err).slice(0, 200)));
    page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("Electron Security Warning") && !m.text().includes("Insecure Content")) errors.push(("c:" + m.text()).slice(0, 200)); });
  }
  return { app, page, vite };
}

export async function shutdown(app, vite = null, mock = null) {
  try { await app.close(); } catch {}
  if (vite) { try { process.kill(-vite.pid, "SIGKILL"); } catch {} }
  try { execSync(`pkill -9 -f "${ROOT}/node_modules/.bin/vite"; pkill -9 -f "npm exec vite"`, { stdio: "ignore" }); } catch {}
  if (mock) mock.close();
}

export const sleep = (page, ms) => page.waitForTimeout(ms);

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

export async function enterProject(page, name) {
  await goToProjects(page);
  const proj = page.locator("li:visible").filter({ hasText: name }).first();
  if (!(await proj.count())) return false;
  await proj.click();
  await page.waitForTimeout(1000);
  return true;
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
  const tLeave = Date.now();
  while (Date.now() - tLeave < 5000) {
    if ((await label()) !== "发送") break;
    await page.waitForTimeout(200);
  }
  const tBack = Date.now();
  while (Date.now() - tBack < 15000) {
    if ((await label()) === "发送") break;
    await page.waitForTimeout(300);
  }
}
