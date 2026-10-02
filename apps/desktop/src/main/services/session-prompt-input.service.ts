/**
 * Builds {@link PromptLlmInput} for current agent + session (real prompt / token count).
 */
import { type AgentDefinition, resolveAgentForProject } from "@novel-master/core/agent";
import { prepareUserMessagesForPrompt } from "@novel-master/core/chat";
import { buildPromptLlmInputFromLayout, type AgentPromptLayout, type PromptLlmInput, type PromptRenderContext } from "@novel-master/core/prompt";
import {
  assembleWorkplaceDisplay,
  WorkplaceAssemblyAbortedError,
} from "@novel-master/core/workplace";
import type { ChatMessage } from "@novel-master/core/chat";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

export interface SessionPromptScope {
  readonly projectId: string;
  readonly sessionId: string;
}

/**
 * chip 刷新的中途弃权信号（r3-dt-align 第 3 层，与 mobile 同款）：读口的
 * build 与发送链共享 main 进程的单事件循环与单 SQLite 连接，会话消息一多，
 * build 整串装配本身就是秒级重活。**build 分段间 + build/resolve 关键边界
 * 检查**（本类只覆盖 build 段内部的分段检查点；build→resolve 之间那道与
 * resolve 段内部的整串级重活分别由读口的边界检查点与 core 抛的
 * `PromptTokenResolveBailedError` 负责——三类弃权点在读口同款 catch 里收成
 * 同一个 null 哨兵）命中即抛本错误，调用方（token 读口）捕获后按「保留旧
 * 标签」收场，**不触发 fallback 重算**。
 *
 * 非读口消费方（预览 `prompt-preview.service` 等）不传 shouldBail，行为不变。
 */
export class ChatPromptBuildBailedError extends Error {
  constructor() {
    super("chat prompt build bailed (run in flight)");
    this.name = "ChatPromptBuildBailedError";
  }
}

export interface BuildSessionPromptInputOptions {
  /** 分段间防御性退出判定；真值即抛 {@link ChatPromptBuildBailedError}。 */
  readonly shouldBail?: () => boolean;
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
  options?: BuildSessionPromptInputOptions,
): Promise<SessionPromptInputBundle> {
  // 分段弃权：每段之间看一眼「run 是不是已经起步了」。mobile 真机实锤过
  // 这条链会把 POST 派发从 +1.2s 拖到 +19.6s（build 与发送链抢同一条 SQLite
  // 连接），desktop main 是同进程同连接，问题一模一样。
  const shouldBail = options?.shouldBail;
  const bail = (): void => {
    if (shouldBail?.() === true) {
      throw new ChatPromptBuildBailedError();
    }
  };

  const resolved =
    definition ??
    (await resolveAgentForProject(runtime, scope.projectId, scope.sessionId))
      .definition;
  bail();

  // 只拉可见消息（SQL 层滤 hidden）：chip 的 prompt 组装只消费可见历史，
  // 大会话里 hidden（压缩/置位产物）往往占多数，全量拉回并逐条解压正文
  // 在大会话上是秒级卡顿（与 mobile 同款修法）。
  const visibleMessages = await runtime.messages.listBySession(
    scope.sessionId,
    { includeHidden: false },
  );
  bail();
  const wtScope = {
    kind: "session" as const,
    projectId: scope.projectId,
    sessionId: scope.sessionId,
  };
  const wt = runtime.workplace(wtScope);
  const vfs = runtime.sessionVfs(scope.projectId, scope.sessionId);
  // assemble → prepare(S0)，与 agent-runner 同源。workplace 段内部按文件粒度
  // 挂分段弃权判据（2026-09-30 mobile「16s 原子组装段」治本的同款下沉）：
  // run 起步后本刷新在第一个文件边界就死；中止错误就地转抛 build 的统一
  // 哨兵类，读口 catch 的判定不变。fingerprint 透传给 ctx——token 估算读数
  // 的记忆缓存靠它免掉重复序列化/计数。
  let assembled: Awaited<ReturnType<typeof assembleWorkplaceDisplay>>;
  try {
    assembled = await assembleWorkplaceDisplay(
      wtScope,
      {
        sessionKkv: runtime.sessionKkv,
        workplace: wt,
        vfs,
        layout: resolved.prompts,
      },
      { shouldStop: () => shouldBail?.() === true },
    );
  } catch (error) {
    if (error instanceof WorkplaceAssemblyAbortedError) {
      throw new ChatPromptBuildBailedError();
    }
    throw error;
  }
  const { workplaceDisplay, prefixPaths, visiblePaths, fingerprint } = assembled;
  bail();
  const messages = await prepareUserMessagesForPrompt(visibleMessages, {
    sessionId: scope.sessionId,
    sessionKkv: runtime.sessionKkv,
    vfs,
    seenPaths: prefixPaths,
    // S0 双读（v1.5.30）：attach 去重只吃 full 档，workplace 省略判定吃全量可见档。
    workplaceSeenPaths: visiblePaths,
    extraInfo: resolved.prompts.customAttach,
    now: new Date(),
    workplace: wt,
    // skillAttach hydrate（`$技能` 首次引用附全文），与 agent-runner 同源。
    skills: runtime.skills(),
    projectId: scope.projectId,
    // read 引用块 hydrate（read-tool-result-ref Step 6）：parity 链（token
    // 计数 / 压缩评估）与 agent-runner 主链共用 prepare，字符口径一致。
    revisionRepo: runtime.revisionRepo,
  });
  bail();
  const ctx: PromptRenderContext = {
    workplaceDisplay,
    messages,
    workplace: wt,
    vfs,
    workplaceFingerprint: fingerprint,
  };
  // 预览与 token 计数默认 agentStepIndex 为 0，含 once dynamic 块
  const input = await buildPromptLlmInputFromLayout(resolved.prompts, ctx);
  return { definition: resolved, layout: resolved.prompts, ctx, input, rawMessages: visibleMessages };
}
