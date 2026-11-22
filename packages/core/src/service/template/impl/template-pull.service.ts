/**
 * Template pull orchestration (VFS replace + worktree replace).
 *
 * global → project 的模板拉取链已随全局文件管理器迭代拆除；本服务仅保留
 * project → session 的初始化链（{@link initializeSessionWorkspace}）。
 *
 * @module service/template/impl/template-pull.service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { DeferredBlobGc } from "@/domain/vfs/logic/deferred-blob-gc.js";
import { SessionWorkspaceInit } from "@/service/template/logic/initialize-session-workspace.js";
import { SessionWorkspacePush } from "@/service/template/logic/push-session-workspace.js";
import { SessionPromptCaches } from "@/service/session-kkv/logic/clear-session-prompt-caches.js";
import { SessionKkvServiceFactory } from "@/service/session-kkv/create-session-kkv-service.js";
import type { TemplatePullService } from "../template-pull.port.js";

/**
 * Default template pull: replace session subtree from project template.
 */
export class DefaultTemplatePullService implements TemplatePullService {
    constructor(private readonly conn: TdbcConnection) {}

    /** nm-style: keep-public — TemplatePullService 端口方法；chat session.service 单点消费。 */
    async pullSessionTemplate(sessionId: string): Promise<Result<void, AppError>> {
        const sessions = new SqliteSessionRepository(this.conn);
        const session = await sessions.findById(sessionId);
        if (session == null) {
            return Result.err(new AppError("CHAT_NOT_FOUND", { detail: `session not found: ${sessionId}`, kind: "session", id: sessionId }));
        }
        await this.conn.transaction(async (tx) => {
            await SessionWorkspaceInit.initialize(tx, session.projectId, sessionId, {
                clearCheckpoints: true,
            });
        });
        await DeferredBlobGc.run(this.conn);
        // 模板拉取是 session scope 的整树覆盖（文件正文/路径树/规则快照全变），
        // 与角色卡 / ZIP 导入同族，必须对齐 prompt 缓存：rule_snapshot + file_cache
        // 两域清空 + 失效 prompt token cache + toolUseCount 哨兵。
        // 不清的话 file_cache 读口命中即无条件返回、不校验 mtime，agent 的
        // <workplace> 前缀会继续注入已被替换掉的旧正文。
        // pushSessionTemplate 不加：push 是会话 → 项目方向，会话侧文件树不变，
        // 自己的 file_cache 依然有效，清了只会让下一 step 无谓重算。
        await SessionPromptCaches.clear(sessionId, SessionKkvServiceFactory.create(this.conn));
        return Result.ok(undefined);
    }

    /** nm-style: keep-public — TemplatePullService 端口方法；chat session.service 单点消费。 */
    async pushSessionTemplate(sessionId: string): Promise<Result<void, AppError>> {
        // 推送与拉取同一套校验/事务/GC 骨架，只是方向对调（session → project）。
        const sessions = new SqliteSessionRepository(this.conn);
        const session = await sessions.findById(sessionId);
        if (session == null) {
            return Result.err(new AppError("CHAT_NOT_FOUND", { detail: `session not found: ${sessionId}`, kind: "session", id: sessionId }));
        }
        await this.conn.transaction(async (tx) => {
            await SessionWorkspacePush.push(tx, session.projectId, sessionId);
        });
        await DeferredBlobGc.run(this.conn);
        return Result.ok(undefined);
    }
}
