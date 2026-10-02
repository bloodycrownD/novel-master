/**
 * Default session service.
 *
 * @module service/chat/impl/session.service
 */

import { randomUUID } from "@/infra/random-uuid.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { ChatSession } from "@/domain/chat/model/session.js";
import type {
  SessionAgentConfig,
  SessionAgentConfigPatch,
} from "@/domain/chat/model/session-agent-config.js";
import { sessionAgentConfigSchema } from "@/domain/chat/model/session-agent-config.schema.js";
import type { ProjectRepository } from "@/domain/chat/repositories/project.port.js";
import type { SessionRepository } from "@/domain/chat/repositories/session.port.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { seedForkCopyParity } from "@/domain/chat/logic/seed-fork-copy-parity.js";
import {
  copyVfsTree,
  deleteVfsPrefix,
} from "@/domain/vfs/logic/vfs-tree-copy.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import {
  aggregateReadRefs,
  aggregateReadRefPointers,
  adjustReadRefCount,
} from "@/domain/vfs/logic/revision-ref-count.js";
import { DefaultTemplatePullService } from "@/service/template/impl/template-pull.service.js";
import { chatInvalidArgument, chatNotFound } from "@/errors/chat-errors.js";
import { decode } from "@/infra/serialization/decode.js";
import { SqliteProjectRepository } from "@/domain/chat/repositories/impl/sqlite-project.repository.js";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import {
  deleteSessionFsData,
  runDeferredBlobGc,
} from "@/service/session-fs/create-session-fs-service.js";
import { createSessionKkvService } from "@/service/session-kkv/create-session-kkv-service.js";
import { invalidateSessionApiPromptTokenEntry } from "@/infra/tokenizer/logic/session-api-prompt-token-store.js";
import { runDeferredFileCacheGc } from "@/domain/session-kkv/logic/deferred-file-cache-gc.js";
import { createSessionRunStateService } from "@/service/session-run-state/create-session-run-state-service.js";
import { initializeSessionWorkspace } from "@/service/template/logic/initialize-session-workspace.js";
import { resolveWorkspaceAgentForNewSession } from "@/service/agent/logic/agent-run-shared.js";
import type { SessionService } from "../session.port.js";

function reposFor(conn: TdbcConnection) {
  return {
    projects: new SqliteProjectRepository(conn),
    sessions: new SqliteSessionRepository(conn),
    messages: new SqliteMessageRepository(conn),
    vfs: new SqliteVfsEntryRepository(conn),
  };
}

function parseStoredSessionAgentConfig(json: string): SessionAgentConfig {
  return decode(JSON.parse(json), sessionAgentConfigSchema);
}

/** 永远写非 null wire JSON（agentId 必填，schema 校验已保证非空）。 */
function serializeSessionAgentConfigForStorage(
  config: SessionAgentConfig
): string {
  return JSON.stringify(sessionAgentConfigSchema.toWire(config));
}

/** Dependencies for {@link DefaultSessionService}. */
export interface SessionServiceDeps {
  readonly conn: TdbcConnection;
  readonly projects: ProjectRepository;
  readonly sessions: SessionRepository;
  readonly messages: MessageRepository;
  readonly vfs: VfsEntryRepository;
  /** 用于新建会话时读 workspace 当前 agentId + modelId。 */
  readonly state: {
    getCurrentAgentId(): Promise<string | null | undefined>;
    getCurrentModelId(): Promise<string | null | undefined>;
  };
  /** agentId 缺失时回落 registry 第一个 agent。 */
  readonly agentRegistry: {
    listAgentIds(): Promise<readonly string[]>;
  };
}

/**
 * Session service; `create` copies project template into session VFS.
 */
export class DefaultSessionService implements SessionService {
  constructor(private readonly deps: SessionServiceDeps) {}

  async listByProject(projectId: string): Promise<ChatSession[]> {
    await this.requireProject(projectId);
    return this.deps.sessions.listByProject(projectId);
  }

  async get(id: string): Promise<ChatSession> {
    const session = await this.deps.sessions.findById(id);
    if (session == null) {
      throw chatNotFound("session", id);
    }
    return session;
  }

  async create(projectId: string, title?: string | null): Promise<ChatSession> {
    await this.requireProject(projectId);
    // 复制 workspace 当前 agentId + modelId 落到新会话；agentId 缺失回落 registry 首项。
    // 读取放在事务外：state / agentRegistry 走的是另一套表，不需要在 chat_session 事务内同步。
    const agentId = await resolveWorkspaceAgentForNewSession({
      state: this.deps.state,
      agentRegistry: this.deps.agentRegistry,
    });
    if (agentId == null || agentId === "") {
      throw chatInvalidArgument(
        "新建会话失败：workspace 未配置 Agent，且 registry 为空"
      );
    }
    const workspaceModelId = await this.deps.state.getCurrentModelId();
    const config: SessionAgentConfig =
      workspaceModelId == null || workspaceModelId === ""
        ? { agentId }
        : { agentId, modelId: workspaceModelId };
    const configJson = serializeSessionAgentConfigForStorage(config);
    return this.deps.conn.transaction(async (tx) => {
      const r = reposFor(tx);
      const now = Date.now();
      const session: ChatSession = {
        id: randomUUID(),
        projectId,
        title: title ?? null,
        parentSessionId: null,
        createdAtMs: now,
        updatedAtMs: now,
      };
      await r.sessions.insert(session);
      await initializeSessionWorkspace(tx, projectId, session.id, {
        clearCheckpoints: false,
      });
      await r.sessions.setSessionAgentConfig(session.id, configJson, now);
      return session;
    });
  }

  async createSubSession(
    parentSessionId: string,
    projectId: string,
    title?: string | null
  ): Promise<ChatSession> {
    // 子会话不初始化任何工作区：文件只有一个工作区（父 session VFS），子 agent
    // 的工具操作由 runChildAgent 装配期直接指向父 session scope。这里只 insert
    // session 记录（带 parentSessionId），不碰 VFS / KKV。
    //
    // 父 session 校验在事务外读（对齐主 session create 的风格：校验在事务外）。
    const parent = await this.deps.sessions.findById(parentSessionId);
    if (parent == null) {
      throw chatNotFound("session", parentSessionId);
    }
    if (parent.projectId !== projectId) {
      throw chatInvalidArgument(
        `createSubSession: parent projectId ${parent.projectId} !== ${projectId}`
      );
    }
    const now = Date.now();
    const session: ChatSession = {
      id: randomUUID(),
      projectId,
      title: title ?? null,
      parentSessionId,
      createdAtMs: now,
      updatedAtMs: now,
    };
    await this.deps.sessions.insert(session);
    return session;
  }

  async rename(id: string, title: string): Promise<ChatSession> {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      throw chatInvalidArgument("session title must not be empty");
    }
    const existing = await this.get(id);
    const updatedAtMs = Date.now();
    const updated = await this.deps.sessions.updateTitle(
      id,
      trimmed,
      updatedAtMs
    );
    if (!updated) {
      throw chatNotFound("session", id);
    }
    return { ...existing, title: trimmed, updatedAtMs };
  }

  async delete(id: string): Promise<void> {
    const session = await this.get(id);
    await this.deps.conn.transaction(async (tx) => {
      await this.deleteSessionTree(tx, session);
    });
    await runDeferredBlobGc(this.deps.conn);
    // file_cache 引用行随上面的事务删除，缓存 blob 的回收同样在提交后调度
    await runDeferredFileCacheGc(this.deps.conn);
  }

  /**
   * 递归删除 session 及其全部子 session（messages/fs/kkv/run_state/vfs 全清）。
   *
   * 必须在事务内调：先 `listByParentSession` 取直接子，递归调本函数删子，
   * 再删自己。子 session delete 时 `deleteVfsPrefix(session:{pid}:{childId})`
   * 是无害空操作（子 session 根本没建过 VFS scope），不需 special-case 跳过。
   *
   * @remarks **修法 3（`yieldFn` 透传）本波未做 ⇒ 这里的窄投影读仍是同步 parse。**
   *          C1-5 修法 3 是可选项（`SessionServiceDeps` 增 `messageRowYieldFn` +
   *          `reposFor(tx, yieldFn)` 透传），落地后这条递归链上的逐行
   *          `JSON.parse` 才会分片让出事件循环。当前形态下 `deleteSessionTree`
   *          整段（含 N 层递归）都同步 parse 完才进下一步；会话消息量级大时，
   *          这一段的锁持有期 = 全部子会话的 `JSON.parse` 之和。
   *          ⚠️ 补这条之前先想清楚：让出事件循环等于把一次临界区切成若干段，
   *          与「产出写集合的读必须留在事务内」（wave-c2 判据）并不冲突
   *          （读仍**在**事务内），但会让等锁的写方有机会插队——所以它是
   *          **可选**而非必做，spec 的验收 I6 也写明「仅当修法 3 做了才立」。
   */
  private async deleteSessionTree(
    tx: TdbcConnection,
    session: ChatSession
  ): Promise<void> {
    const r = reposFor(tx);
    // 先递归删全部子 session（深度优先，避免删自己后子变孤儿）。
    const children = await r.sessions.listByParentSession(session.id);
    for (const child of children) {
      await this.deleteSessionTree(tx, child);
    }
    // read 引用 −1（被删会话全部消息，消息内去重、消息间累加）：fork/copy 出的
    // **其它**会话的引用不受影响——ref_count 不归零的 revision/blob 自动留存。
    // 窄投影读口（4 列）替掉 21 列全量读：删除链要的只是 id + read 引用指针。
    // ⚠️ 读**留在事务内**——它产出的正是要减的那批写集合（按 wave-c2 的判据
    // 「产出写集合的读必须留在事务内」）。本条只降列数，不动事务边界。
    await adjustReadRefCount(
      new SqliteVfsRevisionRepository(tx),
      aggregateReadRefPointers(
        (await r.messages.listReadRefTargetsBySession(session.id)).map(
          (t) => t.refs
        )
      ),
      -1
    );
    await r.messages.deleteBySession(session.id);
    await deleteSessionFsData(tx, session.id, session.projectId);
    await createSessionKkvService(tx).clearSession(session.id);
    // 同事务清 run_state 行：留着孤儿 starting/running 行会在重启水合时
    // 生成幽灵 interrupted 单元（递归子会话在本函数逐层清理时一并覆盖）。
    await createSessionRunStateService(tx).deleteBySession(session.id);
    await deleteVfsPrefix(
      r.vfs,
      `session:${session.projectId}:${session.id}`,
      "/"
    );
    const deleted = await r.sessions.delete(session.id);
    if (!deleted) {
      throw chatNotFound("session", session.id);
    }
  }

  async pullTemplate(sessionId: string): Promise<void> {
    await this.get(sessionId);
    await new DefaultTemplatePullService(this.deps.conn).sessionTemplatePull(
      sessionId
    );
  }

  async pushTemplate(sessionId: string): Promise<void> {
    await this.get(sessionId);
    await new DefaultTemplatePullService(this.deps.conn).sessionTemplatePush(
      sessionId
    );
  }

  async getComposerDraftJson(id: string): Promise<string | null> {
    await this.get(id);
    return this.deps.sessions.getComposerDraftJson(id);
  }

  async setComposerDraftJson(
    id: string,
    draftJson: string | null
  ): Promise<boolean> {
    await this.get(id);
    return this.deps.sessions.setComposerDraftJson(id, draftJson);
  }

  async getSessionAgentConfig(id: string): Promise<SessionAgentConfig> {
    await this.get(id);
    const json = await this.deps.sessions.getSessionAgentConfig(id);
    if (json == null) {
      // migration 后不应有 NULL；这里视为异常，提示运行 session-agent-config-v2。
      throw chatInvalidArgument(
        "session agent config missing, run migration session-agent-config-v2"
      );
    }
    return parseStoredSessionAgentConfig(json);
  }

  async updateSessionAgentConfig(
    id: string,
    patch: SessionAgentConfigPatch
  ): Promise<SessionAgentConfig> {
    await this.get(id);
    // partial overlay merge：拿当前配置当基线，patch 里只覆盖出现的字段。
    const baseline = await this.getSessionAgentConfig(id);
    // agentId：不传或空串都当作「保持」，传非空串才覆盖。
    const agentId =
      patch.agentId != null && patch.agentId !== ""
        ? patch.agentId
        : baseline.agentId;
    // modelId：undefined 保持当前；null 清除；非空串覆盖。
    let modelId: string | undefined;
    if (patch.modelId === undefined) {
      modelId = baseline.modelId;
    } else if (patch.modelId === null) {
      modelId = undefined;
    } else {
      modelId = patch.modelId;
    }
    const merged: SessionAgentConfig =
      modelId == null ? { agentId } : { agentId, modelId };
    // merge 完走 schema 校验（agentId 必填）+ 规范化（含 strict）。
    const validated = decode(
      sessionAgentConfigSchema.toWire(merged),
      sessionAgentConfigSchema
    );
    const updatedAtMs = Date.now();
    const configJson = serializeSessionAgentConfigForStorage(validated);
    const updated = await this.deps.sessions.setSessionAgentConfig(
      id,
      configJson,
      updatedAtMs
    );
    if (!updated) {
      throw chatNotFound("session", id);
    }
    // 会话级「切 Agent / 切模型」改变了 prompt 的 system 段与 layout：旧的
    // api 占用按 savedModelId 指纹兜不住 agentId 变更，会以 api 口径（跳掉
    // 0.85 安全垫）继续参与阈值判定，而且已落库 KKV、跨重启继续生效。
    // 读口没有任何 agent 指纹可作第二道防线，正确性完全依赖这一个挂点。
    // 口径收窄：只比较 overlay merge 前后真正变化的字段，避免把「patch 里
    // 出现但值相同」的无效写也清掉（那会让收窄白写，还多一次 KKV 写）。
    if (
      validated.agentId !== baseline.agentId ||
      validated.modelId !== baseline.modelId
    ) {
      await invalidateSessionApiPromptTokenEntry(
        createSessionKkvService(this.deps.conn),
        id
      );
    }
    return validated;
  }

  /**
   * 复制会话（VFS + 消息 + agent 配置）。
   *
   * @remarks **不**复制 `session_kkv_entry`；新会话侧 kkv 为空，首次拼装重建。
   * agent_config_json 直接复制源会话原始 JSON（不再默认 follow）。
   * composer_draft_json 维持现状不复制。
   *
   * 消息的**全量读**在事务之外（与 `fork` 同款形状）：旧形态在写事务里对源会话
   * 做 21 列全量读 + N 次 `JSON.parse`，全程独占连接写锁。头投影救不了这一侧——
   * 下面 `aggregateReadRefs` 要从 blocks 统计 contentRef 并对**源** revision +1，
   * 必须拿到正文；收益全部来自「不再在写事务里做 N 次 parse」。
   * ⚠️ 引入的 TOCTOU 窗口后果是「复制到一个稍旧快照」——copy 的语义本就是快照，
   * 可接受；这里刻意不引入新锁（引入就退化成今天的全事务形态）。
   */
  async copy(id: string): Promise<ChatSession> {
    const source = await this.get(id);
    // 事务外读：repo 绑 `this.deps.conn`（不是 tx）——在事务回调里用外层 conn
    // 会撞驱动层 AsyncMutex 不可重入，那是死锁不是报错。
    const messages = await reposFor(this.deps.conn).messages.listBySession(
      source.id
    );
    const now = Date.now();
    const copy: ChatSession = {
      id: randomUUID(),
      projectId: source.projectId,
      title: source.title == null ? null : `${source.title} (copy)`,
      // P2-13：fork/copy 出的是独立主会话，不继承源会话的 parent 关系。
      parentSessionId: null,
      createdAtMs: now,
      updatedAtMs: now,
    };
    const newMessages: { id: string }[] = [];
    // 逐条 INSERT 改成先构造数组再一次 batchInsert，把 M 次 round-trip 收敛成 1 次。
    const copyMessages = messages.map((msg) => {
      const newId = randomUUID();
      newMessages.push({ id: newId });
      return { ...msg, id: newId, sessionId: copy.id };
    });

    return this.deps.conn.transaction(async (tx) => {
      // 事务回调里出现的每一个 repo 都必须来自 tx。
      const r = reposFor(tx);
      await r.sessions.insert(copy);
      // 刻意不复制 session_kkv（SPEC：fork/copy 不复制 kkv）
      // 刻意不复制 composer_draft_json（维持现状）
      // agent_config_json：继承源会话配置（v2 后 agentId 必填，源不会是 NULL）
      const sourceAgentConfigJson = await r.sessions.getSessionAgentConfig(
        source.id
      );
      if (sourceAgentConfigJson != null) {
        await r.sessions.setSessionAgentConfig(
          copy.id,
          sourceAgentConfigJson,
          now
        );
      }
      // 顺序钉死：VFS → MSG(ids) → helper(REV + RULE + CK)
      // entry_id 化后会话独立 scope：session:{pid}:{sid}，逻辑前缀为 "/"
      await copyVfsTree(
        r.vfs,
        { scopeKey: `session:${source.projectId}:${source.id}` },
        "/",
        { scopeKey: `session:${source.projectId}:${copy.id}` },
        "/",
        { contentStore: new SqliteVfsContentStore(tx) }
      );
      await r.messages.batchInsert(copyMessages);
      // copy 消息浅拷贝原样保留 contentRef 的 (entryId, version)（指向源会话的
      // revision）——按全局键对**源** revision +1，与 fork 同款换算。
      await adjustReadRefCount(
        new SqliteVfsRevisionRepository(tx),
        aggregateReadRefs(messages.map((m) => m.content)),
        +1
      );
      await seedForkCopyParity(tx, {
        projectId: source.projectId,
        sourceSessionId: source.id,
        targetSessionId: copy.id,
        newMessages,
      });
      return copy;
    });
  }

  private async requireProject(projectId: string): Promise<void> {
    const project = await this.deps.projects.findById(projectId);
    if (project == null) {
      throw chatNotFound("project", projectId);
    }
  }
}
