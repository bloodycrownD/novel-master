/**
 * Builds {@link PromptLlmInput} for current agent + session (real prompt / token count).
 */
import {
  type AgentDefinition,
  resolveAgentForProject,
} from '@novel-master/core/agent';

import {
  buildPromptLlmInputFromLayout,
  type AgentPromptLayout,
  type PromptLlmInput,
  type PromptRenderContext,
} from '@novel-master/core/prompt';
import type { MobileNovelMasterRuntime } from '../runtime/types';
import { applyActiveRegexChannel } from './regex-apply-channel';
import { getCapturedBlockOrCaptureForMobile } from './worktree-block.service';

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
  const messages = await applyActiveRegexChannel(
    runtime.regexConfig,
    activeGroupId,
    allMessages,
    visible,
    'llm',
  );
  const block = await getCapturedBlockOrCaptureForMobile(runtime, scope);
  const wt = runtime.worktree({
    kind: 'session',
    projectId: scope.projectId,
    sessionId: scope.sessionId,
  });
  const vfs = runtime.sessionVfs(scope.projectId, scope.sessionId);
  const ctx: PromptRenderContext = {
    worktreeDisplay: block.worktreeDisplay,
    messages,
    worktree: wt,
    vfs,
  };
  const input = await buildPromptLlmInputFromLayout(resolved.prompts, ctx);
  return { definition: resolved, layout: resolved.prompts, ctx, input };
}
