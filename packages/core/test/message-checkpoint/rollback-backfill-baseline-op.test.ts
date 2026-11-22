/**
 * baseline checkpoint backfill 操作的 detect → repair 端到端测试（S-8 / Step 20）。
 *
 * 验证把 {@link BackfillBaselineCheckpoints.backfill} 包成 {@link IntegrityRepairOperation} 后：
 * - 空会话 / 没 live 文件时 detect 返回 needsRepair=false；
 * - 有空窗消息时 detect 返回 needsRepair=true；
 * - repair 真补上 baseline checkpoint；
 * - 补完后再 detect 返回 needsRepair=false（幂等）。
 */
import {  unwrap  } from "../helpers/result-unwrap.js";
import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  TextBlocks  } from "@novel-master/core/chat";
import {  BackfillBaselineCheckpoints  } from "@/domain/message-checkpoint/logic/backfill-baseline-checkpoints.js";
import {  SqliteVfsEntryRepository  } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import {  SqliteMessageRepository  } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import {  SqliteMessageCheckpointRepository  } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import {  SqliteSessionKkvRepository  } from "@/domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.js";
import {  BACKFILL_CURSOR_LAST_SCANNED_COUNT_KEY, SESSION_KKV_DOMAIN_BACKFILL_CURSOR  } from "@/domain/session-kkv/model/session-kkv-domains.js";
import {  getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix  } from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("rollback-backfill-baseline-op: BackfillBaselineCheckpoints.createOperation", () => {
    it("空会话（无消息）detect 返回 needsRepair=false", async () => {
        const ctx = getNovelMasterTestContext();
        const project = unwrap(await ctx.projects.create(`P-op-empty-${testIsolationSuffix()}`));
        const session = unwrap(await ctx.sessions.create(project.id));

        const op = BackfillBaselineCheckpoints.createOperation({
            entryRepo: new SqliteVfsEntryRepository(ctx.conn),
            messageRepo: new SqliteMessageRepository(ctx.conn),
            checkpointRepo: new SqliteMessageCheckpointRepository(ctx.conn),
            sessionKkv: new SqliteSessionKkvRepository(ctx.conn),
            projectId: project.id,
            sessionId: session.id,
        });

        const detection = unwrap(await op.detect());
        assert.equal(detection.needsRepair, false);
    });

    it("有空窗消息时 detect=true，repair 补齐后再 detect=false", async () => {
        const ctx = getNovelMasterTestContext();
        const suffix = testIsolationSuffix();
        const project = unwrap(await ctx.projects.create(`P-op-gap-${suffix}`));
        const session = unwrap(await ctx.sessions.create(project.id));
        const svfs = ctx.sessionVfs(project.id, session.id);

        // 模拟 Step 9 之前的旧会话：写文件 + 写消息，全程不 capture → 所有消息都是空窗
        await svfs.write("/anchor.md", "at-send", { versionCheck: false });
        unwrap(await ctx.messages.append(session.id, "user", TextBlocks.of("anchor")));
        unwrap(await ctx.messages.append(session.id, "assistant", {
            blocks: [{ type: "text", text: "hi" }],
        }));

        const op = BackfillBaselineCheckpoints.createOperation({
            entryRepo: new SqliteVfsEntryRepository(ctx.conn),
            messageRepo: new SqliteMessageRepository(ctx.conn),
            checkpointRepo: new SqliteMessageCheckpointRepository(ctx.conn),
            sessionKkv: new SqliteSessionKkvRepository(ctx.conn),
            projectId: project.id,
            sessionId: session.id,
        });

        const before = unwrap(await op.detect());
        assert.equal(before.needsRepair, true, "有空窗消息时应标记需修复");

        await op.repair();

        const after = unwrap(await op.detect());
        assert.equal(after.needsRepair, false, "补齐 baseline 后应不再需要修复");
    });

    it("游标短路：backfillMissingBaselines 确认无空窗后 detect 不再全量找空窗", async () => {
        const ctx = getNovelMasterTestContext();
        const suffix = testIsolationSuffix();
        const project = unwrap(await ctx.projects.create(`P-op-cursor-${suffix}`));
        const session = unwrap(await ctx.sessions.create(project.id));
        const svfs = ctx.sessionVfs(project.id, session.id);

        await svfs.write("/a.md", "v1", { versionCheck: false });
        unwrap(await ctx.messages.append(session.id, "user", TextBlocks.of("1")));
        unwrap(await ctx.messages.append(session.id, "assistant", {
            blocks: [{ type: "text", text: "2" }],
        }));

        // 经 service 入口跑一次全量并落游标（detect 只读不写，游标由 backfill 路径写）。
        unwrap(await ctx.messageCheckpoint.backfillMissingBaselines(session.id, project.id));
        const kkv = new SqliteSessionKkvRepository(ctx.conn);
        assert.deepEqual(
            unwrap(await kkv.get(
                session.id,
                SESSION_KKV_DOMAIN_BACKFILL_CURSOR,
                BACKFILL_CURSOR_LAST_SCANNED_COUNT_KEY
            )),
            { sessionId: session.id, domain: SESSION_KKV_DOMAIN_BACKFILL_CURSOR, key: BACKFILL_CURSOR_LAST_SCANNED_COUNT_KEY, value: "2" },
            "前置：游标已落库"
        );

        const op = BackfillBaselineCheckpoints.createOperation({
            entryRepo: new SqliteVfsEntryRepository(ctx.conn),
            messageRepo: new SqliteMessageRepository(ctx.conn),
            checkpointRepo: new SqliteMessageCheckpointRepository(ctx.conn),
            sessionKkv: kkv,
            projectId: project.id,
            sessionId: session.id,
        });
        const detection = unwrap(await op.detect());
        assert.equal(detection.needsRepair, false, "两段式短路时 detect 无需修复");
    });
});
