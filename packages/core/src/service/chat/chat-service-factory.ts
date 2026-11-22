/**
 * Chat service factory.
 *
 * @module service/chat/chat-service-factory
 */

import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteProjectRepository } from "@/domain/chat/repositories/impl/sqlite-project.repository.js";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "@/domain/tool/logic/tool-runner.js";
import { BuiltinTools } from "@/domain/tool/builtin/register-builtin-tools.js";
import type { BuiltinToolContext } from "@/domain/tool/builtin/builtin-tool-context.js";
import { VfsServiceFactory } from "@/service/vfs/vfs-service-factory.js";
import { MessageCheckpointFactory } from "@/service/message-checkpoint/message-checkpoint-factory.js";
import { SessionKkvServiceFactory } from "@/service/session-kkv/create-session-kkv-service.js";
import { WorkplaceServiceFactory } from "@/service/workplace/create-workplace-service.js";
import { DefaultProjectService } from "./impl/project.service.js";
import { DefaultSessionService } from "./impl/session.service.js";
import { DefaultMessageService } from "./impl/message.service.js";
import { DefaultUsageStatsService } from "./impl/usage-stats.service.js";
import { DefaultMessageTranscriptEffectsService } from "./impl/message-transcript-effects.service.js";
import { DefaultUserVfsTurnService } from "./impl/user-vfs-turn.service.js";
import type { ProjectService } from "./project.port.js";
import type { SessionService } from "./session.port.js";
import type { MessageService } from "./message.port.js";
import type { UsageStatsService } from "./usage-stats.port.js";
import type { MessageTranscriptEffectsService } from "./message-transcript-effects.port.js";
import type { UserVfsTurnService } from "./user-vfs-turn.port.js";

/** Shared chat services wired from one connection. */
interface ChatServiceBundle {
    readonly projects: ProjectService;
    readonly sessions: SessionService;
    readonly messages: MessageService;
    readonly usageStats: UsageStatsService;
}

/**
 * Session service 创建所需的额外依赖：读 workspace 当前 agentId/modelId
 * 以及 registry 首项回落。
 */
export interface ChatServicesSessionDeps {
    readonly state: {
        getCurrentAgentId(): Promise<Result<string | undefined, AppError>>;
        getCurrentModelId(): Promise<Result<string | undefined, AppError>>;
    };
    readonly agentRegistry: {
        listAgentIds(): Promise<readonly string[]>;
    };
}

/**
 * {@link ChatServiceFactory.createBundle} 可选装配项（rollback-large-jank Step 2）。
 *
 * @remarks yieldFn 注入 messageRepo 列表行解析的片间让步（runtime.messages
 * 链——token 标签、prompt input 等全量 listBySession 的消费方自动受益）；
 * 缺省不传 → repository 直通同步 map，与现状逐字节等价（desktop/cli 零影响）。
 */
interface ChatServicesOptions {
    readonly yieldFn?: () => Promise<void>;
}

/** `ChatServiceFactory.createUserVfsTurnBundle` 杩斿洖鍊笺€?*/
interface UserVfsTurnServiceBundle {
    readonly userVfsTurn: UserVfsTurnService;
}

export const ChatServiceFactory = {
    /**
   * Creates project, session, and message services sharing repositories.
   *
   * @param conn - Open connection after {@link NovelMasterBootstrap.bootstrap}
   * @param sessionDeps - Session service 创建会话时读 workspace 当前指针所需；
   *   projects/messages 不消费此参数。
   * @param options - 可选装配项（yieldFn 列表解析让步）；缺省 = 现状行为。
   */
    createBundle(conn: TdbcConnection, sessionDeps: ChatServicesSessionDeps, options?: ChatServicesOptions): ChatServiceBundle {
        const projectRepo = new SqliteProjectRepository(conn);
        const sessionRepo = new SqliteSessionRepository(conn);
        const messageRepo = new SqliteMessageRepository(conn, options?.yieldFn);
        const vfsRepo = new SqliteVfsEntryRepository(conn);
        const checkpointRepo = new SqliteMessageCheckpointRepository(conn);
        const revisionRepo = new SqliteVfsRevisionRepository(conn);

        const projects = new DefaultProjectService({
            conn,
            projects: projectRepo,
            sessions: sessionRepo,
            messages: messageRepo,
            vfs: vfsRepo,
        });

        const sessions = new DefaultSessionService({
            conn,
            projects: projectRepo,
            sessions: sessionRepo,
            messages: messageRepo,
            vfs: vfsRepo,
            state: sessionDeps.state,
            agentRegistry: sessionDeps.agentRegistry,
        });

        const messages = new DefaultMessageService({
            conn,
            sessions: sessionRepo,
            messages: messageRepo,
            vfs: vfsRepo,
            checkpoints: checkpointRepo,
            revisions: revisionRepo,
        });

        const usageStats = new DefaultUsageStatsService(conn);

        return { projects, sessions, messages, usageStats };
    },

    /**
   * Creates a {@link MessageService} instance.
   *
   * yieldFn 只由 desktop/mobile 主 runtime 经 ChatServiceFactory.createBundle
   * bundle 注入；若未来需经本工厂注入再加可选参。
   */
    createMessage(conn: TdbcConnection): MessageService {
        const sessionRepo = new SqliteSessionRepository(conn);
        const messageRepo = new SqliteMessageRepository(conn);
        const vfsRepo = new SqliteVfsEntryRepository(conn);
        const checkpointRepo = new SqliteMessageCheckpointRepository(conn);
        const revisionRepo = new SqliteVfsRevisionRepository(conn);
        return new DefaultMessageService({ conn, sessions: sessionRepo, messages: messageRepo, vfs: vfsRepo, checkpoints: checkpointRepo, revisions: revisionRepo });
    },

    /**
   * 装配 chat 基础四仓储（projects / sessions / messages / vfs）；conn 或事务 tx 均可。
   *
   * project / session service 的事务块共用这组 domain 仓储构造；`revisions`
   * 只有 project.copy / project.delete 的 VFS 清理链消费，由 project service
   * 在基础四仓储之上自行追加，session 侧不构造无用实例。
   */
    createRepoDeps(conn: TdbcConnection) {
        return {
            projects: new SqliteProjectRepository(conn),
            sessions: new SqliteSessionRepository(conn),
            messages: new SqliteMessageRepository(conn),
            vfs: new SqliteVfsEntryRepository(conn),
        };
    },

    /**
   * 创建消息 transcript 副作用服务（置位成功时 clear session kkv）。
   *
   * @param conn - 已 bootstrap 的数据库连接
   */
    createMessageTranscriptEffects(conn: TdbcConnection): MessageTranscriptEffectsService {
        return new DefaultMessageTranscriptEffectsService({
            conn,
            messages: ChatServiceFactory.createMessage(conn),
            sessionKkv: SessionKkvServiceFactory.create(conn),
        });
    },

    /**
   * 鍒涘缓鐢ㄦ埛 VFS turn 鏈嶅姟涓庢鎺?append 闂寘锛堝叡浜繛鎺ヤ笌 repo锛夈€?
   */
    createUserVfsTurnBundle(conn: TdbcConnection): UserVfsTurnServiceBundle {
        const sessionRepo = new SqliteSessionRepository(conn);
        const messageRepo = new SqliteMessageRepository(conn);
        const vfsRepo = new SqliteVfsEntryRepository(conn);
        const checkpointRepo = new SqliteMessageCheckpointRepository(conn);
        const revisionRepo = new SqliteVfsRevisionRepository(conn);

        const messages = new DefaultMessageService({
            conn,
            sessions: sessionRepo,
            messages: messageRepo,
            vfs: vfsRepo,
            checkpoints: checkpointRepo,
            revisions: revisionRepo,
        });

        const registry = new ToolRegistry<BuiltinToolContext>();
        BuiltinTools.register(registry);
        const toolRunner = new ToolRunner(registry);
        const sessionKkv = SessionKkvServiceFactory.create(conn);

        const userVfsTurn = new DefaultUserVfsTurnService({
            conn,
            sessions: sessionRepo,
            sessionKkv,
            messages,
            chatMessages: messageRepo,
            checkpoints: checkpointRepo,
            entries: vfsRepo,
            revisions: revisionRepo,
            toolRunner,
            resolveToolCtx: (sessionId: string, projectId: string): BuiltinToolContext => ({
                vfs: VfsServiceFactory.createScoped(conn, { kind: "session", projectId, sessionId }),
                projectId,
                sessionId,
                sessionKkv,
                // 目录规则默认启用：与 agent 链路（runAgentTurn）同款注入 session scope
                // workplace，保证 write / mkdir 的补规则行为在两条链路一致。
                workplace: WorkplaceServiceFactory.create(conn, { kind: "session", projectId, sessionId }),
                // A-14 path policy：用户 VFS turn 走 toolCtx 也走默认不限制语义；
                // 后续根据 agent 定义 / project 策略收紧时在此注入。
                allowedPaths: undefined,
            }),
            messageCheckpoint: MessageCheckpointFactory.create(conn),
        });

        return {
            userVfsTurn,
        };
    },
} as const;
