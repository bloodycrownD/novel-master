/**
 * Manual 压缩 IPC 测试：handleCompactionManual 调 runCompaction 后的行为。
 *
 * T-IPC1：runCompaction 成功后清预置的 session kkv（file_cache / rule_snapshot），
 * 保留 user_vfs_pending，并调 notifyComposerStatusAfterFloorOrCompaction（SPEC L274）。
 * 该函数最终经 notifyComposerAttachmentsSuggestToRenderer 向 renderer 广播
 * COMPOSER_ATTACHMENTS_SUGGEST，用 setComposerAttachmentsSuggestForwardTarget 注入假 webContents
 * 捕获 send，即可观测调用是否发生（与同目录其他测试同范式）。
 *
 * T-CR5：原测 condition 压缩走 eventOrchestrator.emit 的旧路径（Step 9 已删该装配）。
 * Step 20 改为测 runCompaction：验证「无预置 kkv 数据」的干净 session 下再次调
 * handleCompactionManual（内部走 runCompaction）仍返回 data.ok=true 并触发 composer 广播——
 * 覆盖了 T-IPC1（预置了 kkv）未验证的维度，即 runCompaction 对空 kkv 的容错。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import { handleCompactionManual } from "../src/main/ipc/handlers/compaction.js";
import { handleMessagesAppend } from "../src/main/ipc/handlers/messages.js";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleAgentRegistryCreateBlank } from "../src/main/ipc/handlers/agent-registry.js";
import { handleAgentSetCurrent } from "../src/main/ipc/handlers/agent.js";
import { handleSessionsCreate } from "../src/main/ipc/handlers/sessions.js";
import { IPC_CHANNELS } from "../shared/ipc-types.js";
import { setComposerAttachmentsSuggestForwardTarget } from "../src/main/ipc/forward-composer-attachments-suggest.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("handleCompactionManual", () => {
  let tempDir: string;
  let projectId: string;
  let sessionId: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-compaction-"));

    const project = await handleProjectsCreate({ name: "compaction-ipc" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    projectId = project.data.id;

    // 新 core 下 session 创建要求 workspace 已配置 agent。
    const blank = await handleAgentRegistryCreateBlank();
    assert.equal(blank.ok, true);
    if (blank.ok) {
      await handleAgentSetCurrent({ agentId: blank.data.agentId });
    }

    const session = await handleSessionsCreate({
      projectId,
      title: "compaction-session",
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    sessionId = session.data.id;

    await handleMessagesAppend({ sessionId, role: "user", text: "u1" });
    await handleMessagesAppend({ sessionId, role: "assistant", text: "a1" });
    await handleMessagesAppend({ sessionId, role: "user", text: "u2" });
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("T-IPC1: manual 压缩 runCompaction 成功后清 file_cache + rule_snapshot，保留 pending", async () => {
    const rt = await getDesktopRuntime();
    const pendingJson = JSON.stringify([
      {
        actionXml: '<action name="mkdir"><path>/keep</path></action>',
        tools: [{ id: "t1", name: "vfs_mkdir" }],
        createdAtMs: 1,
      },
    ]);
    await rt.sessionKkv.set(
      sessionId,
      "file_cache",
      "full:/a.md",
      JSON.stringify({ body: "x", mtimeMs: 1 }),
    );
    await rt.sessionKkv.set(sessionId, "rule_snapshot", "canon", "[]");
    await rt.sessionKkv.set(
      sessionId,
      "user_vfs_pending",
      "queue",
      pendingJson,
    );

    // SPEC L274：runCompaction 成功后调 notifyComposerStatusAfterFloorOrCompaction，
    // 该函数最终经 notifyComposerAttachmentsSuggestToRenderer 向 renderer 广播
    // COMPOSER_ATTACHMENTS_SUGGEST。注入假 webContents 捕获 send（与同目录
    // notify-composer-status-after-kkv-clear.test.ts 同范式）。
    const sent: Array<{ channel: string; payload: unknown }> = [];
    setComposerAttachmentsSuggestForwardTarget(() => {
      return {
        send(channel: string, payload: unknown) {
          sent.push({ channel, payload });
        },
      } as never;
    });

    const result = await handleCompactionManual({ projectId, sessionId });
    assert.equal(result.ok, true);
    assert.equal(
      await rt.sessionKkv.get(sessionId, "file_cache", "full:/a.md"),
      null,
    );
    assert.equal(
      await rt.sessionKkv.get(sessionId, "rule_snapshot", "canon"),
      null,
    );
    assert.equal(
      await rt.sessionKkv.get(sessionId, "user_vfs_pending", "queue"),
      pendingJson,
    );

    // notifyComposerStatusAfterFloorOrCompaction 被调用：发出一次 COMPOSER_ATTACHMENTS_SUGGEST，
    // payload 携带本次 sessionId。
    const composerBroadcasts = sent.filter(
      (s) => s.channel === IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST,
    );
    assert.equal(
      composerBroadcasts.length,
      1,
      "notifyComposerStatusAfterFloorOrCompaction should broadcast exactly once after successful runCompaction",
    );
    assert.deepEqual(composerBroadcasts[0]?.payload, {
      sessionId,
      attachments: [],
    });

    setComposerAttachmentsSuggestForwardTarget(() => undefined);
  });

  // T-CR5：原测 condition 压缩走 eventOrchestrator.emit（Step 9 已删），
  // Step 20 改为测 runCompaction 对「无预置 kkv」的干净 session 的容错。
  // T-IPC1 预置了 file_cache / rule_snapshot / user_vfs_pending；本用例不预置，
  // 验证 runCompaction 在 kkv 空时仍返回 ok:true 并触发 composer 广播。
  //
  // 注意：core 侧 run-compaction.test.ts 已覆盖 runCompaction 的成败两路；
  // 本用例聚焦 IPC 层 handleCompactionManual → runCompaction → notify 的链路。
  it("T-CR5: 无预置 kkv 时 runCompaction 仍返回 ok 并触发 composer 广播", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    setComposerAttachmentsSuggestForwardTarget(() => {
      return {
        send(channel: string, payload: unknown) {
          sent.push({ channel, payload });
        },
      } as never;
    });

    const result = await handleCompactionManual({ projectId, sessionId });
    assert.equal(result.ok, true);
    assert.equal(
      result.data?.ok,
      true,
      "data.ok 应透传 runCompaction 的 true（kkv 空 不影响成败）",
    );

    // 成功路径仍广播一次 COMPOSER_ATTACHMENTS_SUGGEST（与 T-IPC1 同口径）。
    const composerBroadcasts = sent.filter(
      (s) => s.channel === IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST,
    );
    assert.equal(
      composerBroadcasts.length,
      1,
      "runCompaction 成功时应广播一次 COMPOSER_ATTACHMENTS_SUGGEST",
    );

    setComposerAttachmentsSuggestForwardTarget(() => undefined);
  });
});
