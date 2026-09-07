// R7-3: 子会话（mock 回 task tool_calls → 子会话创建 → task 卡片 → 子会话面板）
import { spawn } from "node:child_process";
import http from "node:http";
import { launchApp, shutdown, shot, goToProjects, sendMessage } from "./lib.mjs";

const errors = [];
// mock：第一轮回 tool_calls（task 工具），tool 结果轮回 stop
const MOCK_PORT = 18099;
let callCount = 0;
const mock = http.createServer((req, res) => {
  req.resume();
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    callCount++;
    const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
    const cb = (delta) => ({ id: "m", object: "chat.completion.chunk", created: 0, model: "glm-regression-test", choices: [{ index: 0, delta, finish_reason: null }] });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const hasToolMsg = body.includes("tool");
    if (callCount === 1) {
      // 第一轮：回 task 工具调用
      res.write(sse(cb({ role: "assistant", content: "" })));
      res.write(sse(cb({
        tool_calls: [{ id: "call_1", type: "function", function: { name: "task", arguments: JSON.stringify({ description: "回归子任务", prompt: "执行回归子任务并简短回复。" }) } }],
      })));
      res.write(sse({ ...cb({}), choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }));
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    // 第二轮（task 子 agent 或主 agent 收 tool 结果）：普通回复
    res.write(sse(cb({ role: "assistant", content: "" })));
    res.write(sse(cb({ content: "子任务完成：这是子智能体的回复。" })));
    res.write(sse({ ...cb({}), choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 } }));
    res.write("data: [DONE]\n\n");
    res.end();
  });
});
await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));

const { app, page, vite } = await launchApp({ errors });
const sleep = (ms) => page.waitForTimeout(ms);

try {
  await page.waitForLoadState("domcontentloaded");
  await sleep(3500);
  const composer = page.locator('textarea[aria-label="消息输入"]');
  if (!(await composer.count())) {
    await goToProjects(page);
    await page.locator("li:visible").filter({ hasText: "回归项目A" }).first().click();
    await sleep(700);
    await page.locator("#session-list li:visible").first().click();
    await sleep(1100);
  }

  await sendMessage(page, "触发子任务：请用 task 工具创建一个子任务。");
  await sleep(3000); // 等子会话 run 完成
  await shot(page, "640", "subagent-run-done");
  const st = await page.evaluate(() => ({
    msgs: document.querySelectorAll(".chat-message").length,
    text: document.getElementById("chat-messages")?.textContent?.slice(0, 250),
    toolCards: document.querySelectorAll("[class*=tool]").length,
  }));
  console.log("SUB_STATE", JSON.stringify(st).slice(0, 350));

  // 找 task 工具卡片（点击进子会话）
  const taskCard = page.locator("[class*=tool]").filter({ hasText: /task|回归子任务|子任务/ }).first();
  if (await taskCard.count()) {
    await taskCard.click().catch(() => {});
    await sleep(1500);
    await shot(page, "641", "subagent-panel");
    const subPanel = await page.evaluate(() => ({
      vis: [...document.querySelectorAll(".chat-nav-view")].filter((v) => !v.hidden).map((v) => v.getAttribute("data-nav-view")),
      text: document.querySelector("#chat-rail")?.textContent?.slice(0, 200),
    }));
    console.log("SUB_PANEL", JSON.stringify(subPanel).slice(0, 300));
    // 返回
    const bk = page.locator('button[aria-label="返回"]:visible').first();
    if (await bk.count()) { await bk.click(); await sleep(600); }
  } else { console.log("TASK_CARD_NOT_FOUND"); }

} catch (e) {
  console.log("SCRIPT_ERROR", String(e).slice(0, 400));
  try { await page.screenshot({ path: "/tmp/r73-err.png" }); } catch {}
}
await shutdown(app, vite, mock);
console.log("R73_DONE errors:", errors.length, JSON.stringify(errors.slice(0, 3)));
