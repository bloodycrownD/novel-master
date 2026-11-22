/**
 * Real prompt preview turns for desktop conversation tab.
 *
 * 轮聚合（prompt-rounds）：返回按「模板段各占一轮 / 真用户输入开新轮 / 其余归
 * assistant 轮」聚合后的轮数组，而不是扁平段数组——renderer 直接按轮渲染，
 * assistant 轮正文已在 `body` 一份字符串里。
 */
import { AssertionError } from "@novel-master/core/common";
import {
    PreviewThinkingContext,
    PromptBuilder,
    ThinkingContext,
    type PromptPreviewTurn,
    type PromptRenderContext,
    type PromptSkillIndexEntry,
} from "@novel-master/core/prompt";
import { BuiltinTools, ToolRegistry } from "@novel-master/core";
import { AgentProjectResolver, AgentTools } from "@novel-master/core/agent";
import { type AppError } from "@novel-master/core/errors";
import { Result } from "@novel-master/core/errors";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { SessionPromptInputService } from "./session-prompt-input.service.js";

interface PromptPreviewScope {
    readonly projectId: string;
    readonly sessionId: string;
}

/** 与 core skill-tool 的 SKILL_TOOL_NAME 同值（core 未公开导出，本地常量）。 */
const SKILL_TOOL_NAME = "skill";

export namespace PromptPreviewService {
    /**
   * Desktop preview adapter：把 desktop runtime 适配到 core 的 prompt 组装与
   * `PromptBuilder.previewTurns`；失败沿用 core 的 `Result` 通道。
   */
    export async function buildRealTurnsAdapter(runtime: DesktopNovelMasterRuntime, scope: PromptPreviewScope): Promise<Result<readonly PromptPreviewTurn[], AppError>> {
        // 错误通道迁移五期：AgentProjectResolver.resolve 沿 Result 回传，Err 并进本函数通道。
        const resolvedAgent = await AgentProjectResolver.resolve(runtime, scope.projectId, scope.sessionId);
        if (!resolvedAgent.ok) return Result.err(resolvedAgent.error);
        const definition = resolvedAgent.value.definition;
        const built = await SessionPromptInputService.buildAdapter(runtime, scope, definition);
        // build 的已知失败沿 Result 原样上行（错误通道迁移四期）。
        if (!built.ok) return Result.err(built.error);
        // 预览不传 shouldBail，弃权（null）不可达——编程错误断言兜住类型联合
        // （error-matrix-final R3 后 buildAdapter 返回值含 null）。
        const bundle = built.value;
        if (bundle == null) {
            // 预览不传 shouldBail，弃权不可达——编程错误（error-matrix-final R3 后
            // buildAdapter 返回值含 null），按不变量破断言出。
            throw new AssertionError("prompt preview 未传 shouldBail，弃权不应出现");
        }
        const { layout, ctx } = bundle;
        // 预算技能索引（与 agent-runner 同源：effectiveSkills 生效清单）。
        // D4 联动：resolve 后 registry 不含 skill（policy 禁用）时保持 undefined，
        // 预览不出现技能索引段——工具与索引同进退。
        const probe = new ToolRegistry();
        BuiltinTools.register(probe);
        const toolRegistry = AgentTools.resolveRegistry(probe, definition);
        let skillsIndex: readonly PromptSkillIndexEntry[] | undefined;
        if (toolRegistry.list().includes(SKILL_TOOL_NAME)) {
            const effective = await runtime.skills().effectiveSkills(scope.projectId);
            if (!effective.ok) {
                // 装配失败沿异常通道上抛（原行为）：清单读取失败不静默降级成无索引。
                const failure = effective.error;
                throw failure;
            }
            skillsIndex = effective.value.filter((s) => s.effective).map((s) => ({ name: s.name, description: s.description ?? "", domain: s.domain }));
        }
        // 思考上下文偏好：预览与 wire 同口径（档位前置门 + 容量 1 保留单点在 core 纯函数）；
        // 判定链已下沉 core（PreviewThinkingContext.resolve），本地不再持有副本。
        const sessionConfig = await runtime.sessions.getSessionAgentConfig(scope.sessionId);
        // 已知失败沿 Result 返回（错误通道迁移四期）：唯一调用方 handlePromptRealPreview
        // 转 `ipcErr(formatIpcError(...))`；本函数其余 await 链仍是未知 throw 面。
        if (!sessionConfig.ok) return Result.err(sessionConfig.error);
        // 错误通道迁移五期：PreviewThinkingContext.resolve 沿 Result 回传。
        const thinkingPreferences = {
            preferences: runtime.preferences,
            savedModels: runtime.savedModelRepo,
            providers: runtime.providerRepo,
            agentModelId: definition.model,
            sessionModelId: sessionConfig.value.modelId,
        };
        const thinkingResult = await PreviewThinkingContext.resolve(thinkingPreferences);
        if (!thinkingResult.ok) return Result.err(thinkingResult.error);
        const thinking = thinkingResult.value;
        // 预览输入 ctx.messages 不含合成消息，但容量 1 判定只看 assistant 消息，
        // 判定代码与 wire 侧同一段，两侧保留集合一致（T-PV2）。
        const filteredMessages = ThinkingContext.applyForLlm(ctx.messages, {
            enabled: thinking.enabled,
            protocol: thinking.protocol,
            retainProtocolMinimum: false,
            requestThinkingEnabled: thinking.requestThinkingEnabled,
        });
        const previewCtx: PromptRenderContext = skillsIndex != null ? { ...ctx, skillsIndex, messages: filteredMessages } : { ...ctx, messages: filteredMessages };
        const turnOptions = { includeThinkingBlocks: thinking.enabled };
        const turns = await PromptBuilder.previewTurns(layout, previewCtx, turnOptions);
        if (!turns.ok) return Result.err(turns.error);
        return Result.ok(turns.value);
    }
}
