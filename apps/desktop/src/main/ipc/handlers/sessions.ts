/**
 * Session CRUD IPC handlers.
 */
import { AppError } from "@novel-master/core/errors";
import { Result } from "@novel-master/core/errors";
import type {
    IpcResult,
    MessageAttachmentDto,
    SessionAgentConfigDto,
    SessionCreateRequest,
    SessionDeleteRequest,
    SessionDto,
    SessionGetComposerDraftRequest,
    SessionListByProjectRequest,
    SessionProjectComposerStatusRequest,
    SessionPullTemplateRequest,
    SessionPushTemplateRequest,
    SessionRenameRequest,
    SessionSetAgentBindingRequest,
    SessionSetComposerDraftRequest,
    SessionSetModelOverrideRequest,
} from "../../../../shared/ipc-types.js";
import { DesktopRuntimeSingleton } from "../../runtime/desktop-runtime-singleton.js";
import { WorkspaceMutatedForwarder } from "../forward-workspace-mutated.js";
import { IpcResults } from "../ipc-result.js";
import { ProjectComposerStatusService } from "../../services/project-composer-status.service.js";

export namespace Sessions {
    function toDto(session: {
        id: string;
        projectId: string;
        title: string | null;
        parentSessionId: string | null;
        createdAtMs: number;
        updatedAtMs: number;
    }): SessionDto {
        return {
            id: session.id,
            projectId: session.projectId,
            title: session.title,
            parentSessionId: session.parentSessionId,
            createdAtMs: session.createdAtMs,
            updatedAtMs: session.updatedAtMs,
        };
    }

    export function listByProject(req: SessionListByProjectRequest): Promise<IpcResult<SessionDto[]>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            return (await rt.sessions.listByProject(req.projectId)).map((list) => list.map(toDto));
        });
    }

    export function create(req: SessionCreateRequest): Promise<IpcResult<SessionDto>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            return (await rt.sessions.create(req.projectId, req.title)).map(toDto);
        });
    }

    export function rename(req: SessionRenameRequest): Promise<IpcResult<SessionDto>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            return (await rt.sessions.rename(req.id, req.title)).map(toDto);
        });
    }

    export function remove(req: SessionDeleteRequest): Promise<IpcResult<void>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            return rt.sessions.delete(req.id);
        });
    }

    export function pullTemplate(req: SessionPullTemplateRequest): Promise<IpcResult<void>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            return rt.sessions.pullSessionTemplate(req.sessionId);
        });
    }

/**
 * 推送到项目工作区：用当前聊天工作区（文件 + workplace 规则）整树覆盖
 * project 模板（该项目所有会话的模板母本）。
 *
 * 成功后 notify 项目工作区面板刷新——注意 IPC 面板语义里 `'session'`
 * 面板就是项目工作区（core project 域），`'chat'` 才是会话域；推送覆盖
 * 的是前者，故 payload 用 `{workspaceScope: 'session', projectId}`。
 * projectId 经会话查询取得（不改 Request 形状）；失败不 notify。
 */
    export function pushTemplate(req: SessionPushTemplateRequest): Promise<IpcResult<void>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            const pushed = await rt.sessions.pushSessionTemplate(req.sessionId);
            if (!pushed.ok) return pushed;
            const session = await rt.sessions.get(req.sessionId);
            if (!session.ok) return Result.err(session.error);
            WorkspaceMutatedForwarder.notify({ workspaceScope: "session", projectId: session.value.projectId });
            return Result.ok(undefined);
        });
    }

    export function getComposerDraft(req: SessionGetComposerDraftRequest): Promise<IpcResult<string | null>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            return rt.sessions.getComposerDraftJson(req.sessionId);
        });
    }

    export function setComposerDraft(req: SessionSetComposerDraftRequest): Promise<IpcResult<boolean>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            return rt.sessions.setComposerDraftJson(req.sessionId, req.draftJson);
        });
    }

    export function projectComposerStatus(req: SessionProjectComposerStatusRequest): Promise<IpcResult<MessageAttachmentDto[]>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            // runtime 装配闸保留（与同文件其它 handler 同口径）；投影本身只读 core 的
            // annotate store，不再需要 runtime（十七期第2轮签名审计）。
            return Result.ok(await ProjectComposerStatusService.forSession(req.sessionId));
        });
    }

/**
 * 写会话级智能体绑定。
 *
 * `agentId: null` 表示将该会话的 agentId 同步为 workspace 当前 agent（作为该会话
 * 的新默认值）；会话始终持有 agentId，这不是解绑/回退，而是「同步到当前默认」。
 * 具体 id 直接写入。返回最新 config，UI 拿到后可直接刷新本地状态（无需重新 GET）。
 *
 * core 的 `updateSessionAgentConfig` 为 partial overlay：只传 `{ agentId }` 时
 * modelId 会被保留，因此切 agent 不会清掉会话上已有的 modelId 覆盖。
 */
    export function setAgentBinding(req: SessionSetAgentBindingRequest): Promise<IpcResult<SessionAgentConfigDto>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            // null 表示同步到 workspace 当前 agent（state 优先，缺失回落 registry 首项）。
            // 会话始终持有 agentId，不存在「解绑」语义。
            let agentId = req.agentId;
            if (agentId == null) {
                const fromState = await rt.state.getCurrentAgentId();
                if (!fromState.ok) return Result.err(fromState.error);
                agentId = fromState.value && fromState.value !== "" ? fromState.value : (await rt.agentRegistry.listAgentIds())[0];
                if (agentId == null || agentId === "") {
                    return Result.err(new AppError("INFRA_UNEXPECTED_ERROR", { detail: "同步 workspace agent 失败：workspace 未配置 Agent，且 registry 为空" }));
                }
            }
            // partial overlay：只传 agentId，core 会保留 modelId（切 agent 不清模型覆盖）。
            return rt.sessions.updateSessionAgentConfig(req.sessionId, { agentId });
        });
    }

/**
 * 写会话级模型覆盖。
 *
 * `modelId: null` 清除覆盖；agentId 保持现状不动。返回最新 config，UI 拿到后
 * 可直接刷新本地状态（无需重新 GET）。
 *
 * core 的 `updateSessionAgentConfig` 为 partial overlay：只传 `{ modelId }` 时
 * agentId 会被保留，`modelId: null` 表示显式清除。因此这里不再需要先读当前
 * config 再回写（去 read-modify-write），直接把 modelId 透传给 core 即可。
 */
    export function setModelOverride(req: SessionSetModelOverrideRequest): Promise<IpcResult<SessionAgentConfigDto>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            // partial overlay：core 接受 modelId: null 表示清除，agentId 自动保留。
            return rt.sessions.updateSessionAgentConfig(req.sessionId, { modelId: req.modelId });
        });
    }
}
