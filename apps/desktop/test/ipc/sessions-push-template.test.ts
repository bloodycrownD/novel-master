/**
 * SESSIONS_PUSH_TEMPLATE handler（workspace-push spec T-WP6）：
 * - 成功：调 rt.sessions.pushTemplate(sessionId)，随后 notify 项目工作区面板刷新，
 *   payload 必须是 IPC 面板语义 `{workspaceScope:'session', projectId}`——
 *   面板 scope 'session' 就是项目工作区（core project 域），'chat' 才是会话域；
 *   projectId 经会话查询取得（不改 Request 形状）。
 * - 失败：pushTemplate 抛错时返回 IpcResult error 且不 notify。
 *
 * runtime mock 走 module hook（与 usage-stats-ipc.test.ts 同范式）：
 * desktop-runtime-singleton 重定向到 stub，从 globalThis 取 runtime。
 * notify 断言在真实 forward-workspace-mutated 上注册 fake webContents。
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { after, beforeEach, describe, it, mock } from "node:test";

import { IPC_CHANNELS } from "../../shared/ipc-types.js";

register(new URL("./sessions-push-runtime-hook.mjs", import.meta.url));const { handleSessionsPushTemplate } = await import(
  "../../src/main/ipc/handlers/sessions.js"
);
const {
  notifyWorkspaceMutatedToRenderer,
  setWorkspaceMutatedForwardTarget,
} = await import("../../src/main/ipc/forward-workspace-mutated.js");

/** fake webContents：捕获 send 的 channel + payload。 */
const sentMessages: { channel: string; payload: unknown }[] = [];
const fakeWebContents = {
  send: (channel: string, payload: unknown) => {
    sentMessages.push({ channel, payload });
  },
};

setWorkspaceMutatedForwardTarget(() => fakeWebContents);
after(() => {
  setWorkspaceMutatedForwardTarget(() => undefined);
});

const pushTemplate = mock.fn(async () => {});
const getSession = mock.fn(async (id: string) => ({
  id,
  projectId: "p-1",
  title: null,
  parentSessionId: null,
  createdAtMs: 0,
  updatedAtMs: 0,
}));

beforeEach(() => {
  pushTemplate.mock.resetCalls();
  getSession.mock.resetCalls();
  sentMessages.length = 0;
});

describe("handleSessionsPushTemplate（T-WP6）", () => {
  it("成功：调 pushTemplate 并以 IPC 面板语义 notify 项目工作区", async () => {
    globalThis.__sessionsPushTestRuntime = {
      sessions: { pushTemplate, get: getSession },
    };

    const result = await handleSessionsPushTemplate({ sessionId: "s-1" });

    assert.equal(result.ok, true);
    assert.equal(pushTemplate.mock.callCount(), 1);
    assert.deepEqual(pushTemplate.mock.calls[0]?.arguments, ["s-1"]);
    // projectId 经会话查询取得（不改 Request 形状）
    assert.equal(getSession.mock.callCount(), 1);
    // notify payload：workspaceScope 'session' = 项目工作区面板（IPC 面板语义）
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0]?.channel, IPC_CHANNELS.WORKSPACE_MUTATED);
    assert.deepEqual(sentMessages[0]?.payload, {
      workspaceScope: "session",
      projectId: "p-1",
    });
  });

  it("失败：pushTemplate 抛错返回 error 且不 notify", async () => {
    pushTemplate.mock.mockImplementation(async () => {
      throw new Error("push failed");
    });
    globalThis.__sessionsPushTestRuntime = {
      sessions: { pushTemplate, get: getSession },
    };

    const result = await handleSessionsPushTemplate({ sessionId: "s-1" });

    assert.equal(result.ok, false);
    // 失败不 notify：send 零次
    assert.equal(sentMessages.length, 0);
    pushTemplate.mock.mockImplementation(async () => {});
  });
});
