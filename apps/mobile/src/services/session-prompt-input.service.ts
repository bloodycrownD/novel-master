/**
 * Builds {@link PromptLlmInput} for current agent + session (real prompt / token count).
 */
import {
  type AgentDefinition,
  resolveAgentForProject,
} from '@novel-master/core/agent';

import { prepareUserMessagesForPrompt } from '@novel-master/core/chat';
import {
  buildPromptLlmInputFromLayout,
  type AgentPromptLayout,
  type PromptLlmInput,
  type PromptRenderContext,
} from '@novel-master/core/prompt';
import { assembleWorkplaceDisplay } from '@novel-master/core/worktree';
import type { MobileNovelMasterRuntime } from '../runtime/types';
import { applyActiveRegexChannel } from './regex-apply-channel';

export interface SessionPromptScope {
  readonly projectId: string;
  readonly sessionId: string;
}

export interface SessionPromptInputBundle {
  readonly definition: AgentDefinition;
  readonly layout: AgentPromptLayout;
  readonly ctx: PromptRenderContext;
  readonly input: PromptLlmInput;
}

/** 可见会话消息 + worktree/VFS 上下文 → 当前 Agent 的 LLM 输入。 */
export async function buildSessionPromptInput(
  runtime: MobileNovelMasterRuntime,
  scope: SessionPromptScope,
  definition?: AgentDefinition,
): Promise<SessionPromptInputBundle> {
  const resolved =
    definition ??
    (await resolveAgentForProject(runtime, scope.projectId)).definition;

  const allMessages = await runtime.messages.listBySession(scope.sessionId);
  const visible = allMessages.filter(m => !m.hidden);
  const activeGroupId = await runtime.state.getCurrentRegexGroupId();
  const regexMessages = await applyActiveRegexChannel(
    runtime.regexConfig,
    activeGroupId,
    allMessages,
    visible,
    'llm',
  );
  const wtScope = {
    kind: 'session' as const,
    projectId: scope.projectId,
    sessionId: scope.sessionId,
  };
  const wt = runtime.worktree(wtScope);
  const vfs = runtime.sessionVfs(scope.projectId, scope.sessionId);
  // prepare 须在 regex 之后、layout 之前（与 agent-runner 同源）。
  const messages = await prepareUserMessagesForPrompt(regexMessages, {
    sessionId: scope.sessionId,
    sessionKkv: runtime.sessionKkv,
    vfs,
  });
  const worktreeDisplay = await assembleWorkplaceDisplay(wtScope, {
    sessionKkv: runtime.sessionKkv,
    worktree: wt,
    vfs,
    layout: resolved.prompts,
  });
  const ctx: PromptRenderContext = {
    worktreeDisplay,
    messages,
    worktree: wt,
    vfs,
  };
  const input = await buildPromptLlmInputFromLayout(resolved.prompts, ctx);
  return { definition: resolved, layout: resolved.prompts, ctx, input };
}
