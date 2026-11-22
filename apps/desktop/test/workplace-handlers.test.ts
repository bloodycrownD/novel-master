/**
 * Workplace IPC：规则保存 → refreshRuleSnapshot；差集 suggest 已废止；遗留 capture → clear kkv。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DesktopRuntimeSingleton } from "../src/main/runtime/desktop-runtime-singleton.js";
import { Projects } from "../src/main/ipc/handlers/projects.js";
import { AgentRegistry } from "../src/main/ipc/handlers/agent-registry.js";
import { Agent } from "../src/main/ipc/handlers/agent.js";
import { Sessions } from "../src/main/ipc/handlers/sessions.js";
import { Workplace } from "../src/main/ipc/handlers/workplace.js";
import { ComposerAttachmentsSuggestForwarder } from "../src/main/ipc/forward-composer-attachments-suggest.js";
import { IPC_CHANNELS } from "../shared/ipc-types.js";
import {
    setupDesktopDbTestEnv,
    teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("workplace ipc handlers", () => {
    let tempDir: string;
    let projectId: string;
    let sessionId: string;

    before(async () => {
        ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-workplace-"));

        const project = await Projects.create({ name: "workplace-ipc" });
        assert.equal(project.ok, true);
        if (!project.ok) {
            return;
        }
        projectId = project.data.id;

        // 新 core 下 session 创建要求 workspace 已配置 agent。
        const blank = await AgentRegistry.createBlank();
        assert.equal(blank.ok, true);
        if (blank.ok) {
            await Agent.setCurrent({ agentId: blank.data.agentId });
        }

        const session = await Sessions.create({
            projectId,
            title: "session-1",
        });
        assert.equal(session.ok, true);
        if (!session.ok) {
            return;
        }
        sessionId = session.data.id;
    });

    after(async () => {
        ComposerAttachmentsSuggestForwarder.setTarget(() => undefined);
        await teardownDesktopDbTestEnv(tempDir);
    });

    it("session buildListRows 成功", async () => {
        const result = await Workplace.buildListRows({
            workspaceScope: "chat",
            projectId,
            sessionId,
        });

        assert.equal(result.ok, true);
        if (result.ok) {
            assert.ok(Array.isArray(result.data));
        }
    });

    it("T-CR2: setDirRule → 写 rule_snapshot canon；file_cache 空；不推差集 suggest", async () => {
        const rtR = await DesktopRuntimeSingleton.get();
        if (!rtR.ok) throw rtR.error;
        const rt = rtR.value;
        await rt.sessionKkv.set(
            sessionId,
            "file_cache",
            "full:/stale.md",
            JSON.stringify({ body: "stale", mtimeMs: 1 }),
        );

        const sent: Array<{ channel: string; payload: unknown }> = [];
        ComposerAttachmentsSuggestForwarder.setTarget(() => {
            return {
                send(channel: string, payload: unknown) {
                    sent.push({ channel, payload });
                },
            } as never;
        });

        const result = await Workplace.setDirRule({
            workspaceScope: "chat",
            projectId,
            sessionId,
            logicalPath: "/",
            ruleEnabled: true,
        });

        assert.equal(result.ok, true);
        const canon = await rt.sessionKkv.get(sessionId, "rule_snapshot", "canon");
        assert.ok(canon != null && canon !== "");
        assert.deepEqual(await rt.sessionKkv.listKeys(sessionId, "file_cache"), []);
        assert.equal(
            sent.filter((s) => s.channel === IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST)
                .length,
            0,
            "规则保存不得再推 workplace 差集 suggest",
        );
        ComposerAttachmentsSuggestForwarder.setTarget(() => undefined);
    });

    it("T-CR2: setFileRule → 写 rule_snapshot；file_cache 空", async () => {
        const rtR = await DesktopRuntimeSingleton.get();
        if (!rtR.ok) throw rtR.error;
        const rt = rtR.value;
        await rt.sessionKkv.set(
            sessionId,
            "file_cache",
            "full:/note.md",
            JSON.stringify({ body: "stale", mtimeMs: 1 }),
        );

        const result = await Workplace.setFileRule({
            workspaceScope: "chat",
            projectId,
            sessionId,
            logicalPath: "/note.md",
            inclusionMode: "show",
        });

        assert.equal(result.ok, true);
        const canon = await rt.sessionKkv.get(sessionId, "rule_snapshot", "canon");
        assert.ok(canon != null && canon !== "");
        assert.deepEqual(await rt.sessionKkv.listKeys(sessionId, "file_cache"), []);
    });

    it("composerAttachmentsSuggest 通道独立；空 attachments 仍 send（整表替换）", async () => {
        const sent: Array<{ channel: string; payload: unknown }> = [];
        ComposerAttachmentsSuggestForwarder.setTarget(() => {
            return {
                send(channel: string, payload: unknown) {
                    sent.push({ channel, payload });
                },
            } as never;
        });

        ComposerAttachmentsSuggestForwarder.notify({
            sessionId,
            attachments: [
                {
                    name: "/x.md",
                    source: "workplace",
                    type: "text",
                    content: null,
                    path: "/x.md",
                },
            ],
        });
        ComposerAttachmentsSuggestForwarder.notify({
            sessionId,
            attachments: [],
        });

        assert.equal(sent.length, 2);
        assert.equal(sent[0]?.channel, IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST);
        assert.deepEqual(sent[0]?.payload, {
            sessionId,
            attachments: [
                {
                    name: "/x.md",
                    source: "workplace",
                    type: "text",
                    content: null,
                    path: "/x.md",
                },
            ],
        });
        assert.deepEqual(sent[1]?.payload, {
            sessionId,
            attachments: [],
        });

        ComposerAttachmentsSuggestForwarder.setTarget(() => undefined);
    });
});
