/**
 * 子 agent 写入后父面板文件树刷新：ShellNavProvider 旁路订阅 agent stream。
 *
 * 子 session 的 run 事件被 ConversationPanel 的 useAgentStream 守卫拒收，
 * ShellNavProvider 需要旁路订阅 STEP_COMMITTED / RUN_FINISHED，
 * 按 projectId 匹配并触发 notifyWorkspaceMutated。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rendererRoot = join(__dirname, "..", "renderer");

describe("ShellNavProvider child-run workspace refresh", () => {
  it("旁路订阅 agent stream：子 run 的 vfsMutated 事件按 projectId 触发树刷新", () => {
    const source = readFileSync(
      join(rendererRoot, "providers", "ShellNavProvider.tsx"),
      "utf8",
    );

    // 复用与 useAgentStream 相同的 IPC 订阅机制
    assert.match(source, /onAgentStream/);
    // 只关心 step 提交与 run 结束两类事件
    assert.match(source, /EVENT_AGENT_STEP_COMMITTED/);
    assert.match(source, /EVENT_AGENT_RUN_FINISHED/);
    // 仅在写入 VFS 且 project 匹配当前导航时触发
    assert.match(source, /p\.vfsMutated !== true/);
    assert.match(source, /p\.projectId !== projectId/);
    // 跳过本会话自己的 run（已由 ConversationPanel 处理）
    assert.match(source, /p\.sessionId === workspaceSessionId/);
    // 最终走 notifyWorkspaceMutated（100ms 防抖内建）
    assert.match(source, /notifyWorkspaceMutated\(\)/);
  });
});
