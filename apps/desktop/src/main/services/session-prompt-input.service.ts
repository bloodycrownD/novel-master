/**
 * Builds {@link PromptLlmInput} for current agent + session (real prompt / token count).
 */
import { type AgentDefinition, resolveAgentForProject } from "@novel-master/core/agent";
import { prepareUserMessagesForPrompt } from "@novel-master/core/chat";
import { buildPromptLlmInputFromLayout, type AgentPromptLayout, type PromptLlmInput, type PromptRenderContext } from "@novel-master/core/prompt";
import { assembleWorkplaceDisplay } from "@novel-master/core/workplace";
import type { ChatMessage } from "@novel-master/core/chat";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

export interface SessionPromptScope {
  readonly projectId: string;
  readonly sessionId: string;
}

export interface SessionPromptInputBundle {
  readonly definition: AgentDefinition;
  readonly layout: AgentPromptLayout;
  readonly ctx: PromptRenderContext;
  readonly input: PromptLlmInput;
  /**
   * 可见消息列表（SQL 层已滤 hidden）：读口本地重算（
   * `resolveCurrentPromptTokens`）直接消费，避免再开一次查询；resolve 侧
   * 的回填参数已废弃，可见口径不影响任何消费方。
   */
  readonly rawMessages: readonly ChatMessage[];
}

export async function buildSessionPromptInput(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
  definition?: AgentDefinition,
): Promise<SessionPromptInputBundle> {
  const resolved =
    definition ??
    (await resolveAgentForProject(runtime, scope.projectId, scope.sessionId))
      .definition;

  // 只拉可见消息（SQL 层滤 hidden）：chip 的 prompt 组装只消费可见历史，
  // 大会话里 hidden（压缩/置位产物）往往占多数，全量拉回并逐条解压正文
  // 在大会话上是秒级卡顿（与 mobile 同款修法）。
  const visibleMessages = await runtime.messages.listBySession(
    scope.sessionId,
    { includeHidden: false },
  );
  const wtScope = {
    kind: "session" as const,
    projectId: scope.projectId,
    sessionId: scope.sessionId,
  };
  const wt = runtime.workplace(wtScope);
  const vfs = runtime.sessionVfs(scope.projectId, scope.sessionId);
  // assemble → prepare(S0)，与 agent-runner 同源。
  const { workplaceDisplay, prefixPaths } = await assembleWorkplaceDisplay(
    wtScope,
    {
      sessionKkv: runtime.sessionKkv,
      workplace: wt,
      vfs,
      layout: resolved.prompts,
    },
  );
  const messages = await prepareUserMessagesForPrompt(visibleMessages, {
    sessionId: scope.sessionId,
    sessionKkv: runtime.sessionKkv,
    vfs,
    seenPaths: prefixPaths,
    extraInfo: resolved.prompts.customAttach,
    now: new Date(),
    workplace: wt,
    // skillAttach hydrate（`$技能` 首次引用附全文），与 agent-runner 同源。
    skills: runtime.skills(),
    projectId: scope.projectId,
  });
  const ctx: PromptRenderContext = {
    workplaceDisplay,
    messages,
    workplace: wt,
    vfs,
  };
  // 预览与 token 计数默认 agentStepIndex 为 0，含 once dynamic 块
  const input = await buildPromptLlmInputFromLayout(resolved.prompts, ctx);
  return { definition: resolved, layout: resolved.prompts, ctx, input, rawMessages: visibleMessages };
}
