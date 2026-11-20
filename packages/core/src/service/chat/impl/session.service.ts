/**
 * Default session service.
 *
 * @module service/chat/impl/session.service
 */

import { Random } from "@/common/random.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { ChatSession } from "@/domain/chat/model/session.js";
import type { SessionAgentConfig, SessionAgentConfigPatch } from "@/domain/chat/model/session-agent-config.js";
import { sessionAgentConfigSchema } from "@/domain/chat/model/session-agent-config.schema.js";
import type { ProjectRepository } from "@/domain/chat/repositories/project.port.js";
import type { SessionRepository } from "@/domain/chat/repositories/session.port.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { forkCopySeeder } from "@/domain/chat/logic/fork-copy-seeder.js";
import { TdbcTransaction } from "@/infra/tdbc/logic/transaction-helper.js";
import type { LongTaskHooks } from "@/domain/abort/model/abort-scope.js";
import { AbortError } from "@/domain/abort/logic/create-abort-error.js";
import { VfsTreeCopy } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { TemplatePullServiceFactory } from "@/service/template/create-template-pull-service.js";
import { AppError, AppErrorOps } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { SerializationDecode } from "@/infra/serialization/decode.js";
import { SessionFsServiceFactory, DeferredBlobGc } from "@/service/session-fs/create-session-fs-service.js";
import { SessionKkvServiceFactory } from "@/service/session-kkv/create-session-kkv-service.js";
import { SessionApiPromptTokenEntry } from "@/infra/tokenizer/logic/session-api-prompt-token-store.js";
import { DeferredFileCacheGc } from "@/domain/session-kkv/logic/deferred-file-cache-gc.js";
import { createSessionRunStateService } from "@/service/session-run-state/create-session-run-state-service.js";
import { SessionWorkspaceInit } from "@/service/template/logic/initialize-session-workspace.js";
import { AgentRunShared } from "@/service/agent/logic/agent-run-shared.js";
import { ChatServiceFactory } from "../chat-service-factory.js";
import type { SessionService } from "../session.port.js";

/** 永远写非 null wire JSON（agentId 必填，schema 校验已保证非空）。toWire 失败沿 `Result.err` 上递（五期门⑦）。 */
function serializeSessionAgentConfigForStorage(config: SessionAgentConfig): Result<string, AppError> {
  return sessionAgentConfigSchema.toWire(config).map((wire) => JSON.stringify(wire));
}

/** Dependencies for {@link DefaultSessionService}. */
interface SessionServiceDeps {
  readonly conn: TdbcConnection;
  readonly projects: ProjectRepository;
  readonly sessions: SessionRepository;
  readonly messages: MessageRepository;
  readonly vfs: VfsEntryRepository;
  /** 用于新建会话时读 workspace 当前 agentId + modelId。 */
  readonly state: {
    getCurrentAgentId(): Promise<Result<string | undefined, AppError>>;
    getCurrentModelId(): Promise<Result<string | undefined, AppError>>;
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

  async listByProject(projectId: string): Promise<Result<ChatSession[], AppError>> {
    const project = await this.deps.projects.findById(projectId);
    if (project == null) {
      return Result.err(new AppError("CHAT_NOT_FOUND", { detail: `project not found: ${projectId}`, kind: "project", id: projectId }));
    }
    return Result.ok(await this.deps.sessions.listByProject(projectId));
  }

  async get(id: string): Promise<Result<ChatSession, AppError>> {
    const session = await this.deps.sessions.findById(id);
    if (session == null) {
      return Result.err(new AppError("CHAT_NOT_FOUND", { detail: `session not found: ${id}`, kind: "session", id }));
    }
    return Result.ok(session);
  }

  async create(projectId: string, title?: string | null): Promise<Result<ChatSession, AppError>> {
    const project = await this.deps.projects.findById(projectId);
    if (project == null) {
      return Result.err(new AppError("CHAT_NOT_FOUND", { detail: `project not found: ${projectId}`, kind: "project", id: projectId }));
    }
    // 复制 workspace 当前 agentId + modelId 落到新会话；agentId 缺失回落 registry 首项。
    // 读取放在事务外：state / agentRegistry 走的是另一套表，不需要在 chat_session 事务内同步。
    const agentIdResult = await AgentRunShared.resolveWorkspaceForNewSession({ state: this.deps.state, agentRegistry: this.deps.agentRegistry });
    if (!agentIdResult.ok) return Result.err(agentIdResult.error);
    const agentId = agentIdResult.value;
    if (agentId == null || agentId === "") {
      return Result.err(new AppError("CHAT_INVALID_ARGUMENT", { descriptor: { key: "error.chat.session_create_agent_missing" } }));
    }
    const currentModel = await this.deps.state.getCurrentModelId();
    if (!currentModel.ok) return Result.err(currentModel.error);
    const workspaceModelId = currentModel.value;
    const config: SessionAgentConfig = workspaceModelId == null || workspaceModelId === "" ? { agentId } : { agentId, modelId: workspaceModelId };
    const serialized = serializeSessionAgentConfigForStorage(config);
    if (!serialized.ok) return Result.err(serialized.error);
    const configJson = serialized.value;
    const createTransaction = this.deps.conn.transaction(async (tx) => {
      const r = ChatServiceFactory.createRepoDeps(tx);
      const now = Date.now();
      const session: ChatSession = {
        id: Random.uuid(),
        projectId,
        title: title ?? null,
        parentSessionId: null,
        createdAtMs: now,
        updatedAtMs: now,
      };
      await r.sessions.insert(session);
      await SessionWorkspaceInit.initialize(tx, projectId, session.id, {
        clearCheckpoints: false,
      });
      await r.sessions.setSessionAgentConfig(session.id, configJson, now);
      return session;
    });
    return Result.ok(await createTransaction);
  }

  async createSubSession(parentSessionId: string, projectId: string, title?: string | null): Promise<Result<ChatSession, AppError>> {
    // 子会话不初始化任何工作区：文件只有一个工作区（父 session VFS），子 agent
    // 的工具操作由 runChildAgent 装配期直接指向父 session scope。这里只 insert
    // session 记录（带 parentSessionId），不碰 VFS / KKV。
    //
    // 父 session 校验在事务外读（对齐主 session create 的风格：校验在事务外）。
    const parent = await this.deps.sessions.findById(parentSessionId);
    if (parent == null) {
      return Result.err(new AppError("CHAT_NOT_FOUND", { detail: `session not found: ${parentSessionId}`, kind: "session", id: parentSessionId }));
    }
    if (parent.projectId !== projectId) {
      return Result.err(new AppError("CHAT_INVALID_ARGUMENT", { detail: `createSubSession: parent projectId ${parent.projectId} !== ${projectId}` }));
    }
    const now = Date.now();
    const session: ChatSession = {
      id: Random.uuid(),
      projectId,
      title: title ?? null,
      parentSessionId,
      createdAtMs: now,
      updatedAtMs: now,
    };
    await this.deps.sessions.insert(session);
    return Result.ok(session);
  }

  async rename(id: string, title: string): Promise<Result<ChatSession, AppError>> {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      return Result.err(new AppError("CHAT_INVALID_ARGUMENT", { detail: "session title must not be empty" }));
    }
    const existing = await this.get(id);
    if (!existing.ok) return existing;
    const updatedAtMs = Date.now();
    const updated = await this.deps.sessions.updateTitle(id, trimmed, updatedAtMs);
    if (!updated) {
      return Result.err(new AppError("CHAT_NOT_FOUND", { detail: `session not found: ${id}`, kind: "session", id }));
    }
    return Result.ok({ ...existing.value, title: trimmed, updatedAtMs });
  }

  async delete(id: string): Promise<Result<void, AppError>> {
    const session = await this.get(id);
    if (!session.ok) return Result.err(session.error);
    // 事务回调内的域失败走「抛错回滚」（deleteSessionTree 根行删除落空抛 CHAT_NOT_FOUND，
    // 改 return 会在「子树已删、根删失败」时提交半删事务）；到本方法边界把**域失败**
    // 收进 Err——签名承诺 Result，调用方按 `!r.ok` 消费（RB4b 边界转码，unwrapTxDomainError
    // 与 revision-aware-vfs 同款：过驱动事务边界后 AppError 被包进 TdbcError.cause）。
    try {
      await this.deps.conn.transaction(async (tx) => {
        await this.deleteSessionTree(tx, session.value);
      });
    } catch (cause) {
      const domain = AppErrorOps.is(cause) ? cause : (cause as { cause?: unknown } | null)?.cause;
      if (domain != null && AppErrorOps.is(domain)) return Result.err(domain);
      throw cause;
    }
    await DeferredBlobGc.run(this.deps.conn);
    // file_cache 引用行随上面的事务删除，缓存 blob 的回收同样在提交后调度
    await DeferredFileCacheGc.run(this.deps.conn);
    return Result.ok(undefined);
  }

  /**
   * 递归删除 session 及其全部子 session（messages/fs/kkv/run_state/vfs 全清）。
   *
   * 必须在事务内调：先 `listByParentSession` 取直接子，递归调本函数删子，
   * 再删自己。子 session delete 时 `VfsTreeCopy.deletePrefix(session:{pid}:{childId})`
   * 是无害空操作（子 session 根本没建过 VFS scope），不需 special-case 跳过。
   *
   * @remarks **修法 3（`yieldFn` 透传）本波未做 ⇒ 这里的窄投影读仍是同步 parse。**
   *          C1-5 修法 3 是可选项（`SessionServiceDeps` 增 `messageRowYieldFn` +
   *          `createChatRepoDeps(tx, yieldFn)` 透传），落地后这条递归链上的逐行
   *          `JSON.parse` 才会分片让出事件循环。当前形态下 `deleteSessionTree`
   *          整段（含 N 层递归）都同步 parse 完才进下一步；会话消息量级大时，
   *          这一段的锁持有期 = 全部子会话的 `JSON.parse` 之和。
   *          ⚠️ 补这条之前先想清楚：让出事件循环等于把一次临界区切成若干段，
   *          与「产出写集合的读必须留在事务内」（wave-c2 判据）并不冲突
   *          （读仍**在**事务内），但会让等锁的写方有机会插队——所以它是
   *          **可选**而非必做，spec 的验收 I6 也写明「仅当修法 3 做了才立」。
   */
  private async deleteSessionTree(tx: TdbcConnection, session: ChatSession): Promise<void> {
    const r = ChatServiceFactory.createRepoDeps(tx);
    // 先递归删全部子 session（深度优先，避免删自己后子变孤儿）。
    const children = await r.sessions.listByParentSession(session.id);
    for (const child of children) {
      await this.deleteSessionTree(tx, child);
    }
    await r.messages.deleteBySession(session.id);
    await SessionFsServiceFactory.deleteData(tx, session.projectId, session.id);
    await SessionKkvServiceFactory.create(tx).clearSession(session.id);
    // 同事务清 run_state 行：留着孤儿 starting/running 行会在重启水合时
    // 生成幽灵 interrupted 单元（递归子会话在本函数逐层清理时一并覆盖）。
    await createSessionRunStateService(tx).deleteBySession(session.id);
    await VfsTreeCopy.deletePrefix(r.vfs, `session:${session.projectId}:${session.id}`, "/");
    const deleted = await r.sessions.delete(session.id);
    if (!deleted) {
      throw new AppError("CHAT_NOT_FOUND", { detail: `session not found: ${session.id}`, kind: "session", id: session.id });
    }
  }

  /** nm-style: keep-public — SessionService 端口方法（runtime.sessions 跨端契约）；树复制权威在 TemplatePullService。 */
  async pullSessionTemplate(sessionId: string): Promise<Result<void, AppError>> {
    return TemplatePullServiceFactory.create(this.deps.conn).pullSessionTemplate(sessionId);
  }

  /** nm-style: keep-public — SessionService 端口方法（runtime.sessions 跨端契约）；树复制权威在 TemplatePullService。 */
  async pushSessionTemplate(sessionId: string): Promise<Result<void, AppError>> {
    return TemplatePullServiceFactory.create(this.deps.conn).pushSessionTemplate(sessionId);
  }

  async getComposerDraftJson(id: string): Promise<Result<string | null, AppError>> {
    const r = await this.get(id);
    if (!r.ok) return Result.err(r.error);
    return Result.ok(await this.deps.sessions.getComposerDraftJson(id));
  }

  async setComposerDraftJson(id: string, draftJson: string | null): Promise<Result<boolean, AppError>> {
    const r = await this.get(id);
    if (!r.ok) return Result.err(r.error);
    return Result.ok(await this.deps.sessions.setComposerDraftJson(id, draftJson));
  }

  async getSessionAgentConfig(id: string): Promise<Result<SessionAgentConfig, AppError>> {
    const r = await this.get(id);
    if (!r.ok) return Result.err(r.error);
    const json = await this.deps.sessions.getSessionAgentConfig(id);
    if (json == null) {
      // migration 后不应有 NULL；这里视为已知失败走返回值，提示运行 session-agent-config-v2。
      return Result.err(new AppError("CHAT_INVALID_ARGUMENT", { detail: "session agent config missing, run migration session-agent-config-v2" }));
    }
    return SerializationDecode.decode(JSON.parse(json), sessionAgentConfigSchema);
  }

  async updateSessionAgentConfig(id: string, patch: SessionAgentConfigPatch): Promise<Result<SessionAgentConfig, AppError>> {
    const r = await this.get(id);
    if (!r.ok) return Result.err(r.error);
    // partial overlay merge：拿当前配置当基线，patch 里只覆盖出现的字段。
    const baseline = await this.getSessionAgentConfig(id);
    if (!baseline.ok) return baseline;
    // agentId：不传或空串都当作「保持」，传非空串才覆盖。
    const agentId = patch.agentId != null && patch.agentId !== "" ? patch.agentId : baseline.value.agentId;
    // modelId：undefined 保持当前；null 清除；非空串覆盖。
    let modelId: string | undefined;
    if (patch.modelId === undefined) {
      modelId = baseline.value.modelId;
    } else if (patch.modelId === null) {
      modelId = undefined;
    } else {
      modelId = patch.modelId;
    }
    const merged: SessionAgentConfig = modelId == null ? { agentId } : { agentId, modelId };
    // merge 完走 schema 校验（agentId 必填）+ 规范化（含 strict）。
    const wire = sessionAgentConfigSchema.toWire(merged);
    if (!wire.ok) return Result.err(wire.error);
    const validated = SerializationDecode.decode(wire.value, sessionAgentConfigSchema);
    if (!validated.ok) return validated;
    const config = validated.value;
    const updatedAtMs = Date.now();
    const configJson = serializeSessionAgentConfigForStorage(config);
    if (!configJson.ok) return Result.err(configJson.error);
    const updated = await this.deps.sessions.setSessionAgentConfig(id, configJson.value, updatedAtMs);
    if (!updated) {
      return Result.err(new AppError("CHAT_NOT_FOUND", { detail: `session not found: ${id}`, kind: "session", id }));
    }
    // 会话级「切 Agent / 切模型」改变了 prompt 的 system 段与 layout：旧的
    // api 占用按 savedModelId 指纹兜不住 agentId 变更，会以 api 口径（跳掉
    // 0.85 安全垫）继续参与阈值判定，而且已落库 KKV、跨重启继续生效。
    // 读口没有任何 agent 指纹可作第二道防线，正确性完全依赖这一个挂点。
    // 口径收窄：只比较 overlay merge 前后真正变化的字段，避免把「patch 里
    // 出现但值相同」的无效写也清掉（那会让收窄白写，还多一次 KKV 写）。
    if (config.agentId !== baseline.value.agentId || config.modelId !== baseline.value.modelId) {
      await SessionApiPromptTokenEntry.invalidate(SessionKkvServiceFactory.create(this.deps.conn), id);
    }
    return Result.ok(config);
  }

  /**
   * 复制会话（VFS + 消息 + agent 配置）。
   *
   * @remarks **不**复制 `session_kkv_entry`；新会话侧 kkv 为空，首次拼装重建。
   * agent_config_json 直接复制源会话原始 JSON（不再默认 follow）。
   * composer_draft_json 维持现状不复制。
   *
   * 消息的**全量读**在事务之外（与 `fork` 同款形状）：旧形态在写事务里对源会话
   * 做 21 列全量读 + N 次 `JSON.parse`，全程独占连接写锁。收益全部来自「不再在
   * 写事务里做 N 次 parse」。
   * ⚠️ 引入的 TOCTOU 窗口后果是「复制到一个稍旧快照」——copy 的语义本就是快照，
   * 可接受；这里刻意不引入新锁（引入就退化成今天的全事务形态）。
   */
  async copy(id: string, hooks?: LongTaskHooks): Promise<Result<ChatSession, AppError>> {
    const source = await this.get(id);
    if (!source.ok) return source;
    const src = source.value;
    // 事务外读：repo 绑 `this.deps.conn`（不是 tx）——在事务回调里用外层 conn
    // 会撞驱动层 AsyncMutex 不可重入，那是死锁不是报错。
    const messagesRead = await ChatServiceFactory.createRepoDeps(this.deps.conn).messages.listBySession(src.id, undefined, hooks);
    if (messagesRead.kind === "failed") return Result.err(messagesRead.error);
    // 中断不是错误：本方法出口是边界，转抛 AbortError（未注入 hooks 时不可达）。
    if (messagesRead.kind !== "completed") throw AbortError.create();
    const messages = messagesRead.value;
    const now = Date.now();
    const copy: ChatSession = {
      id: Random.uuid(),
      projectId: src.projectId,
      title: src.title == null ? null : `${src.title} (copy)`,
      // P2-13：fork/copy 出的是独立主会话，不继承源会话的 parent 关系。
      parentSessionId: null,
      createdAtMs: now,
      updatedAtMs: now,
    };
    const newMessages: { id: string }[] = [];
    // 逐条 INSERT 改成先构造数组再一次 batchInsert，把 M 次 round-trip 收敛成 1 次。
    const copyMessages = messages.map((msg) => {
      const newId = Random.uuid();
      newMessages.push({ id: newId });
      return { ...msg, id: newId, sessionId: copy.id };
    });

    const copyTransaction = this.deps.conn.transaction(async (tx) => {
      // 事务回调里出现的每一个 repo 都必须来自 tx。
      const r = ChatServiceFactory.createRepoDeps(tx);
      await r.sessions.insert(copy);
      // 刻意不复制 session_kkv（SPEC：fork/copy 不复制 kkv）
      // 刻意不复制 composer_draft_json（维持现状）
      // agent_config_json：继承源会话配置（v2 后 agentId 必填，源不会是 NULL）
      const sourceAgentConfigJson = await r.sessions.getSessionAgentConfig(src.id);
      if (sourceAgentConfigJson != null) {
        await r.sessions.setSessionAgentConfig(copy.id, sourceAgentConfigJson, now);
      }
      // 顺序钉死：VFS → MSG(ids) → helper(REV + RULE + CK)
      // entry_id 化后会话独立 scope：session:{pid}:{sid}，逻辑前缀为 "/"
      // 事务边界（平台协议例外）：VFS 复制与批量写入的中断/失败都必须抛错，
      // 才能让驱动整体回滚——直接 return Outcome 会 commit 半写 copy。
      const copyOptions = { contentStore: new SqliteVfsContentStore(tx), hooks };
      const vfsCopied = await VfsTreeCopy.copyTree(r.vfs, { scopeKey: `session:${src.projectId}:${src.id}` }, "/", { scopeKey: `session:${src.projectId}:${copy.id}` }, "/", copyOptions);
      if (vfsCopied.kind === "failed") throw vfsCopied.error;
      if (vfsCopied.kind !== "completed") throw AbortError.create();
      const inserted = await r.messages.batchInsert(copyMessages, hooks);
      if (inserted.kind === "failed") throw inserted.error;
      if (inserted.kind !== "completed") throw AbortError.create();
      // seed 失败靠抛错回滚（总纲 §五例外 2）：事务回调内 return r 不回滚会留下半写 copy，
      // 解包字收口在 unwrapOrRollback（门⑦），异常穿出 transaction 由调用链端点 catch 收口。
      await TdbcTransaction.unwrapOrRollback(await forkCopySeeder.seed(tx, { projectId: src.projectId, sourceSessionId: src.id, targetSessionId: copy.id, newMessages }));
      return copy;
    });
    return Result.ok(await copyTransaction);
  }
}
