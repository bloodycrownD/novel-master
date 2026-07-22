/**
 * Manual / condition 压缩：emit 成功后 clear session kkv（无 BlockStore capture）。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { EVENT_SESSION_COMPACTION_REQUESTED } from "@novel-master/core/events";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import { handleCompactionManual } from "../src/main/ipc/handlers/compaction.js";
import { handleMessagesAppend } from "../src/main/ipc/handlers/messages.js";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleSessionsCreate } from "../src/main/ipc/handlers/sessions.js";
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
    await rt.eventsConfig.setConfig({
      schemaVersion: 2,
      events: {
        [EVENT_SESSION_COMPACTION_REQUESTED]: [
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

  it("T-CR5: manual 压缩 emit 成功后清 file_cache + rule_snapshot，保留 pending", async () => {
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
  });

  it("T-CR5: condition 压缩 orchestrator.emit 成功后亦清 file_cache + rule_snapshot，保留 pending", async () => {
    const rt = await getDesktopRuntime();
    const pendingJson = JSON.stringify([
      {
        actionXml: '<action name="mkdir"><path>/keep2</path></action>',
        tools: [{ id: "t2", name: "vfs_mkdir" }],
        createdAtMs: 2,
      },
    ]);
    await rt.sessionKkv.set(
      sessionId,
      "file_cache",
      "full:/b.md",
      JSON.stringify({ body: "y", mtimeMs: 2 }),
    );
    await rt.sessionKkv.set(sessionId, "rule_snapshot", "canon", "[]");
    await rt.sessionKkv.set(
      sessionId,
      "user_vfs_pending",
      "queue",
      pendingJson,
    );

    const emitResult = await rt.eventOrchestrator.emit(
      EVENT_SESSION_COMPACTION_REQUESTED,
      {
        sessionId,
        projectId,
        trigger: "condition",
      },
    );
    assert.equal(emitResult.ok, true);
    assert.equal(
      await rt.sessionKkv.get(sessionId, "file_cache", "full:/b.md"),
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
  });
});
