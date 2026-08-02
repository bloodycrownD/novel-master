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
  it("渲染聊天名（点击编辑）/ Agent / 模型 / 操作入口（切换 / 查看提示词 / 压缩）", () => {
    const src = readDrawer();
    // 聊天名行内编辑入口（点击 name 进入编辑）
    assert.match(src, /session-detail-drawer__name/);
    assert.match(src, /\{sessionName\}/);
    assert.match(src, /data-session-detail-action="rename"/);
    assert.match(src, /data-session-detail-action="rename-input"/);
    // 不再使用 TextPromptModal 弹窗重命名
    assert.doesNotMatch(src, /TextPromptModal/);
    assert.doesNotMatch(src, /setRenameOpen/);
    // 不再保留「点击重命名」的 title tooltip
    assert.doesNotMatch(src, /title="点击重命名"/);
    // Agent / 模型 区块
    assert.match(src, /session-detail-pick__label.*Agent/s);
    assert.match(src, /session-detail-pick__label.*模型/s);
    // 不再使用 source 标签 / AGENT_SOURCE_LABEL 常量
    assert.doesNotMatch(src, /AGENT_SOURCE_LABEL/);
    assert.doesNotMatch(src, /MODEL_SOURCE_LABEL/);
    assert.doesNotMatch(src, /session-detail-pick__source/);
    // 锁定指示仍保留
    assert.match(src, /session-detail-pick__lock/);
    assert.match(src, /项目锁定/);
    assert.match(src, /智能体锁定/);
    // 操作入口 data hook
    assert.match(src, /data-session-detail-action="switch-agent"/);
    assert.match(src, /data-session-detail-action="switch-model"/);
    assert.match(src, /data-session-detail-action="view-prompt"/);
    assert.match(src, /data-session-detail-action="compact"/);
    // 文案
    assert.match(src, /查看提示词/);
    assert.match(src, /压缩上下文/);
    // 行内编辑交互：Enter 提交 / Escape 取消 / blur 提交
    assert.match(src, /commitRename/);
    assert.match(src, /cancelRename/);
  });

  it("open=false 时不渲染抽屉", () => {
    const src = readDrawer();
    // 提前返回保护
    assert.match(src, /if \(!open\)/);
  });

  it("源码：source !== 'session' 时锁定 agent/model 卡片（与 mobile/B-1 方案一一致）", () => {
    const src = readDrawer();
    // source 默认 'none'（meta 未加载或 session.agentId 指向已删 agent）
    assert.match(src, /meta\?\.source \?\? "none"/);
    // agent 锁：只有 session 才允许切；none / project-custom 一律锁
    assert.match(src, /agentLocked = source !== "session"/);
    // model 同口径收口（原 agent-pin / hasDedicatedModel 判定已废弃）
    assert.match(src, /modelLocked = source !== "session"/);
    // 锁定 toast 引导文案保留
    assert.match(src, /项目锁定/);
    assert.match(src, /已锁定模型/);
    // 旧的 agent-pin / hasDedicatedModel 判定不应再出现
    assert.doesNotMatch(src, /"agent-pin"/);
    assert.doesNotMatch(src, /hasDedicatedModel/);
  });

  it("源码：重命名走行内编辑（ipcSessionsRename）；agent/model 切换走 session 级 IPC", () => {
    const src = readDrawer();
    // 聊天名行内编辑调用 ipcSessionsRename
    assert.match(src, /ipcSessionsRename\(/);
    assert.match(src, /ipcSessionsSetAgentBinding\(/);
    assert.match(src, /ipcSessionsSetModelOverride\(/);
    // 不应再调用 workspace 级 setCurrent
    assert.doesNotMatch(src, /ipcAgentSetCurrent\(/);
    assert.doesNotMatch(src, /ipcModelSetCurrent\(/);
  });

  it("源码：行内编辑竞态防护（submittingRef + 空串短路）[G-1]", () => {
    const src = readDrawer();
    // submittingRef：防止 blur 与 keydown Enter 重复提交
    assert.match(src, /submittingRef/);
    assert.match(src, /if \(submittingRef\.current\)/);
    // 空串或未改动 → 直接退出，不调用 IPC
    assert.match(src, /!trimmed/);
    assert.match(src, /trimmed === sessionName/);
  });

  it("源码：agent picker 不允许 none；model picker 允许 none 且措辞修正", () => {
    const src = readDrawer();
    // 会话必须持有 agentId → agent picker 不允许 none，无“回退工作区”措辞
    assert.doesNotMatch(src, /解除会话绑定/);
    // model picker 保留 allowNone，措辞改为“清除会话覆盖（使用智能体锁定模型）”
    assert.match(src, /清除会话覆盖（使用智能体锁定模型）/);
    // 旧的“回退工作区”措辞已全部移除
    assert.doesNotMatch(src, /回退工作区/);
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
});
