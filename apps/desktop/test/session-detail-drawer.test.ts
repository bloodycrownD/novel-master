/**
 * T-D3：SessionDetailDrawer 渲染聊天名 / agent / model / 操作入口；
 *      project-custom 时 agent 切换禁用；agent 带 pin 时 model 切换禁用。
 * T-D4：App.tsx 入口替换——原 #session-actions-menu 不再渲染；
 *      openSessionActions 触发 SessionDetailDrawer。
 *
 * Desktop 测试约束（spec）：renderToStaticMarkup + 源码字符串断言轻量风格。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rendererRoot = join(__dirname, "..", "renderer");

/**
 * SessionDetailDrawer 依赖 ShellNavProvider + IPC bridge，SSR 下难以整挂；
 * 按 spec「源码字符串断言轻量风格」原则，结构与渲染标记走源码断言。
 */
function readDrawer(): string {
  return readFileSync(
    join(rendererRoot, "features", "chat", "SessionDetailDrawer.tsx"),
    "utf8",
  );
}

describe("SessionDetailDrawer (T-D3)", () => {
  it("渲染聊天名 / Agent / 模型 / 操作入口（重命名 / 切换 / 查看提示词 / 压缩）", () => {
    const src = readDrawer();
    // 聊天名展示
    assert.match(src, /session-detail-drawer__name/);
    assert.match(src, /\{sessionName\}/);
    // Agent / 模型 区块
    assert.match(src, /session-detail-pick__label.*Agent/s);
    assert.match(src, /session-detail-pick__label.*模型/s);
    // 操作入口 data hook
    assert.match(src, /data-session-detail-action="rename"/);
    assert.match(src, /data-session-detail-action="switch-agent"/);
    assert.match(src, /data-session-detail-action="switch-model"/);
    assert.match(src, /data-session-detail-action="view-prompt"/);
    assert.match(src, /data-session-detail-action="compact"/);
    // 文案
    assert.match(src, /重命名/);
    assert.match(src, /查看提示词/);
    assert.match(src, /压缩上下文/);
  });

  it("open=false 时不渲染抽屉", () => {
    const src = readDrawer();
    // 提前返回保护
    assert.match(src, /if \(!open\)/);
  });

  it("源码：project-custom 锁定 agent 切换；session 可改", () => {
    const src = readDrawer();
    // agent 锁：source === "project-custom"（project-custom 截断锁定，session 可改）
    assert.match(src, /agentLocked = source === "project-custom"/);
    // model 锁：modelSource === "agent-pin" || hasDedicatedModel
    assert.match(src, /modelLocked/);
    assert.match(src, /"agent-pin"/);
    assert.match(src, /hasDedicatedModel/);
    // project-custom 锁定 toast 引导
    assert.match(src, /项目专属智能体/);
    // agent pin 锁定 toast 引导
    assert.match(src, /已固定模型/);
  });

  it("源码：agent/model 切换走 session 级 IPC（传 sessionId）", () => {
    const src = readDrawer();
    assert.match(src, /ipcSessionsSetAgentBinding\(/);
    assert.match(src, /ipcSessionsSetModelOverride\(/);
    // 不应再调用 workspace 级 setCurrent
    assert.doesNotMatch(src, /ipcAgentSetCurrent\(/);
    assert.doesNotMatch(src, /ipcModelSetCurrent\(/);
  });
});

describe("App.tsx 入口替换 (T-D4)", () => {
  it("不再渲染 #session-actions-menu；改为挂载 SessionDetailDrawer", () => {
    const appSrc = readFileSync(join(rendererRoot, "App.tsx"), "utf8");
    // 原 session-actions-menu 浮动菜单块已移除
    assert.doesNotMatch(appSrc, /id="session-actions-menu"/);
    // 入口挂载 SessionDetailDrawer
    assert.match(appSrc, /SessionDetailDrawer/);
    // openSessionActions 改为打开抽屉
    assert.match(appSrc, /setSessionDetailOpen\(true\)/);
  });

  it("源码：WorkspaceFooter 锁判定 project-custom 锁 / session 可改", () => {
    const footerSrc = readFileSync(
      join(rendererRoot, "features", "chat", "WorkspaceFooter.tsx"),
      "utf8",
    );
    // project-custom 锁 agent；session 可改（判定或注释中体现）
    assert.match(footerSrc, /project-custom/);
    assert.match(footerSrc, /session/);
    // model pin 锁定检测
    assert.match(footerSrc, /"agent-pin"/);
    assert.match(footerSrc, /hasDedicatedModel/);
    // 写回改 session 级 IPC
    assert.match(footerSrc, /ipcSessionsSetAgentBinding\(/);
    assert.match(footerSrc, /ipcSessionsSetModelOverride\(/);
  });
});
