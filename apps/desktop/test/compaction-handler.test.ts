/**
 * Manual / condition 压缩：runCompaction / orchestrator.emit 成功后 clear session kkv（无 BlockStore capture）。
 *
 * T-IPC1 额外验证：runCompaction 成功后调 notifyComposerStatusAfterFloorOrCompaction
 * （SPEC L274）。该函数最终经 notifyComposerAttachmentsSuggestToRenderer 向 renderer
 * 广播 COMPOSER_ATTACHMENTS_SUGGEST，用 setComposerAttachmentsSuggestForwardTarget
 * 注入假 webContents 捕获 send，即可观测调用是否发生（与同目录其他测试同范式）。
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

    const rt = await getDesktopRuntime();
    // eventsConfig 的 setup 保留到阶段五（Step 15-17 删 UI 时一并清）；
    // orchestrator 已于 Step 9 移除，runCompaction 直调路径不读 eventsConfig，
    // 此处仅维持既有 DB 状态以便 T-IPC1 的 runCompaction 断言可复现。
    await rt.eventsConfig.setConfig({
      schemaVersion: 2,
      events: {
        ["session.compaction.requested"]: [
          { type: "hide-message", params: { startDepth: 1 } },
        ],
      },
    });

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

  // Step 9 已删除 desktop runtime 的 eventOrchestrator 装配，
  // T-CR5 测的 rt.eventOrchestrator.emit 旧路径不复存在。
  // 该用例在 Step 20（phase-test-cleanup）统一改为测 runCompaction。
  it.skip("T-CR5: condition 压缩旧路径（eventOrchestrator.emit）已在 Step 9 移除，Step 20 统一改", async () => {
    // Step 20 将根据当时的压缩入口重写本用例。
  });
});
