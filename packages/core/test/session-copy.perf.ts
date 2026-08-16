/**
 * session.copy 性能基准（.perf.ts 后缀不入常规测试套件，tsx 手动运行）。
 *
 * 按真机库规模（chat_message 2192 / message_checkpoint_file 21875 ≈ 10 文件每消息）
 * 造同构数据，测量 sessions.copy() 耗时。用法：
 *   npx tsx --tsconfig tsconfig.test.json test/session-copy.perf.ts
 *
 * @module performance/session-copy.perf
 */

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  bootstrapNovelMaster,
  createPersistentState,
  decode,
  open,
} from "@novel-master/core";
import {
  agentDefinitionSchema,
  createAgentRegistryService,
} from "@novel-master/core/agent";
import {
  createMessageService,
  createProjectService,
  createSessionService,
  textBlocks,
} from "@novel-master/core/chat";
import { createScopedVfsService } from "@novel-master/core/vfs";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import { copyVfsTree } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { seedForkCopyParity } from "@/domain/chat/logic/seed-fork-copy-parity.js";
import { listSessionFileHeads } from "@/domain/message-checkpoint/logic/list-session-files.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { SqliteWorkplaceRepository } from "@/domain/workplace/repositories/impl/sqlite-workplace.repository.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import { scopeKey as makeScopeKey } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { workplaceScopeKey } from "@/domain/workplace/logic/workplace-scope.js";

const DB_PATH = "/tmp/nm-session-copy-bench.db";

const fmt = (ms: number): string => `${ms.toFixed(1)}ms`;

async function main(): Promise<void> {
  rmSync(DB_PATH, { force: true });
  registerBetterSqlite3Driver();
  const conn = await open(`tdbc:sqlite:file:${DB_PATH}`, {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: DB_PATH,
  });
  await bootstrapNovelMaster(conn);
  const state = createPersistentState(conn);
  const agentRegistry = createAgentRegistryService(conn, state);
  await agentRegistry.upsert(
    "bench-agent",
    decode(
      {
        schemaVersion: 1,
        name: "bench",
        prompts: { persist: {}, dynamic: {} },
      },
      agentDefinitionSchema,
    ),
  );
  await state.setCurrentAgentId("bench-agent");

  const projects = createProjectService(conn);
  const sessions = createSessionService(conn, { state, agentRegistry });
  const messages = createMessageService(conn);

  const bench = async (
    label: string,
    fileCount: number,
    msgCount: number,
  ): Promise<void> => {
    const project = await projects.create(`bench-${label}`);
    const session = await sessions.create(project.id);
    const vfs = createScopedVfsService(conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    for (let i = 0; i < fileCount; i++) {
      const body = `# file ${i}\n\n${"line.".repeat(200 + (i % 50))}`;
      await vfs.write(`/docs/file-${i}.md`, body, { versionCheck: false });
    }
    for (let i = 0; i < msgCount; i++) {
      await messages.append(
        session.id,
        i % 2 === 0 ? "user" : "assistant",
        textBlocks(`msg ${i}: ${"body".repeat(120)}`),
      );
    }
    for (let round = 1; round <= 3; round++) {
      const t0 = performance.now();
      const copy = await sessions.copy(session.id);
      const elapsed = performance.now() - t0;
      const sk = `session:${project.id}:${copy.id}`;
      const counts = await conn.query<{
        msgs: number;
        files: number;
        revs: number;
        ck_files: number;
      }>(
        `SELECT (SELECT COUNT(*) FROM chat_message WHERE session_id = ?) AS msgs,
          (SELECT COUNT(*) FROM vfs_entry WHERE scope_key = ? AND content_hash IS NOT NULL) AS files,
          (SELECT COUNT(*) FROM vfs_revision r JOIN vfs_entry e ON e.entry_id = r.entry_id WHERE e.scope_key = ?) AS revs,
          (SELECT COUNT(*) FROM message_checkpoint_file WHERE session_id = ?) AS ck_files`,
        [copy.id, sk, sk, copy.id],
      );
      const c = counts[0]!;
      console.log(
        `[${label}] round ${round}: copy ${elapsed.toFixed(1)}ms | ` +
          `msgs=${Number(c.msgs)} files=${Number(c.files)} ` +
          `revs=${Number(c.revs)} ck_files=${Number(c.ck_files)}`,
      );
    }
  };

  const benchPhases = async (
    label: string,
    fileCount: number,
    msgCount: number,
  ): Promise<void> => {
    const project = await projects.create(`bench-${label}`);
    const session = await sessions.create(project.id);
    const vfs = createScopedVfsService(conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    for (let i = 0; i < fileCount; i++) {
      const body = `# file ${i}\n\n${"line.".repeat(200 + (i % 50))}`;
      await vfs.write(`/docs/file-${i}.md`, body, { versionCheck: false });
    }
    for (let i = 0; i < msgCount; i++) {
      await messages.append(
        session.id,
        i % 2 === 0 ? "user" : "assistant",
        textBlocks(`msg ${i}: ${"body".repeat(120)}`),
      );
    }

    console.log(`--- phase breakdown [${label}] ---`);
    for (let round = 1; round <= 3; round++) {
      const phases: string[] = [];
      const t = performance.now();
      await conn.transaction(async (tx) => {
        const sessionRepo = new SqliteSessionRepository(tx);
        const messageRepo = new SqliteMessageRepository(tx);
        const contentStore = new SqliteVfsContentStore(tx);
        const now = Date.now();
        const copySession = {
          id: randomUUID(),
          projectId: project.id,
          title: `${session.title ?? session.id} (copy)`,
          parentSessionId: null,
          createdAtMs: now,
          updatedAtMs: now,
        };
        let t0 = performance.now();
        await sessionRepo.insert(copySession);
        phases.push(`insert-session=${fmt(performance.now() - t0)}`);

        const vfsRepo = new SqliteVfsEntryRepository(tx);
        t0 = performance.now();
        await copyVfsTree(
          vfsRepo,
          { scopeKey: `session:${project.id}:${session.id}` },
          "/",
          { scopeKey: `session:${project.id}:${copySession.id}` },
          "/",
          { contentStore },
        );
        phases.push(`copy-vfs-tree=${fmt(performance.now() - t0)}`);

        t0 = performance.now();
        const list = await messageRepo.listBySession(session.id);
        phases.push(`list-msgs=${fmt(performance.now() - t0)}`);

        t0 = performance.now();
        const newMessages: { id: string }[] = [];
        const copyMessages = list.map((msg) => {
          const id = randomUUID();
          newMessages.push({ id });
          return { ...msg, id, sessionId: copySession.id };
        });
        await messageRepo.batchInsert(copyMessages);
        phases.push(`batch-insert-msgs=${fmt(performance.now() - t0)}`);

        t0 = performance.now();
        // 拆细复刻 seedForkCopyParity，定位其内部热点
        const entries2 = new SqliteVfsEntryRepository(tx);
        const contentStore2 = new SqliteVfsContentStore(tx);
        const revisions2 = new SqliteVfsRevisionRepository(tx);
        const workplace2 = new SqliteWorkplaceRepository(tx);
        const checkpoints2 = new SqliteMessageCheckpointRepository(tx);
        const targetScopeKey = makeScopeKey({ kind: "session", projectId: project.id, sessionId: copySession.id });

        let t1 = performance.now();
        const heads = await listSessionFileHeads(entries2, project.id, copySession.id);
        phases.push(`sp-list-heads=${fmt(performance.now() - t1)}`);

        t1 = performance.now();
        const fileMetas = await entries2.scanFileEntriesWithMeta(targetScopeKey, "/");
        const metaByEntryId = new Map(fileMetas.map((m) => [m.entryId, m]));
        phases.push(`sp-scan-meta=${fmt(performance.now() - t1)}`);

        t1 = performance.now();
        const hashes = [...new Set(heads.map((h) => metaByEntryId.get(h.entryId)?.contentHash).filter((h): h is string => h != null))];
        if (hashes.length > 0) {
          await contentStore2.findExistingBlobHashes(hashes);
        }
        phases.push(`sp-blob-check=${fmt(performance.now() - t1)}`);

        t1 = performance.now();
        const now2 = Date.now();
        await revisions2.batchAppendWithRefCount(heads.map((head) => {
          const meta = metaByEntryId.get(head.entryId);
          return meta == null
            ? { entryId: head.entryId, version: head.headVersion, contentHash: null, status: "deleted", mtimeMs: now2, refCount: 1 }
            : { entryId: head.entryId, version: head.headVersion, contentHash: meta.contentHash, status: "active", mtimeMs: meta.mtimeMs, refCount: 1 };
        }));
        phases.push(`sp-append-revs=${fmt(performance.now() - t1)}`);

        t1 = performance.now();
        await workplace2.copyScope(
          workplaceScopeKey({ kind: "session", projectId: project.id, sessionId: session.id }),
          workplaceScopeKey({ kind: "session", projectId: project.id, sessionId: copySession.id }),
          (p) => normalizePath(p),
        );
        phases.push(`sp-workplace=${fmt(performance.now() - t1)}`);

        t1 = performance.now();
        if (heads.length > 0) {
          await checkpoints2.seedCheckpoints(
            copySession.id,
            newMessages,
            heads.map((h) => ({ entryId: h.entryId, revisionVersion: h.headVersion })),
            now2,
          );
        }
        phases.push(`sp-seed-checkpoints=${fmt(performance.now() - t1)}`);
        phases.push(`seed-parity-total=${fmt(performance.now() - t0)}`);
      });
      console.log(
        `[${label}] round ${round}: total=${fmt(performance.now() - t)} | ${phases.join(" ")}`,
      );
    }
  };

  await bench("tavern-2200msg-10file", 10, 2200);
  await bench("file-heavy-500msg-300file", 300, 500);

  // 分段计时：复刻 session.service copy 的内部流程，定位热点 phase。
  await benchPhases("phases-file-heavy-500msg-300file", 300, 500);

  await conn.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
