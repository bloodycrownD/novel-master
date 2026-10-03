/**
 * Builds {@link PromptLlmInput} for current agent + session (real prompt / token count).
 */
import {
  type AgentDefinition,
  resolveAgentForProject,
} from '@novel-master/core/agent';

import {
  prepareUserMessagesForPrompt,
  type ChatMessage,
} from '@novel-master/core/chat';
import {
  buildPromptLlmInputFromLayout,
  type AgentPromptLayout,
  type PromptLlmInput,
  type PromptRenderContext,
} from '@novel-master/core/prompt';
import {assembleWorkplaceDisplay, WorkplaceAssemblyAbortedError} from '@novel-master/core/workplace';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

export interface SessionPromptScope {
  readonly projectId: string;
  readonly sessionId: string;
}

/**
 * chip 刷新的中途弃权信号（2026-09-30 回滚竞态实锤）：回滚触发的刷新与
 * run 注册（~0.6s 起跑）竞态，冻结闸（只在防抖执行时判定）拦不到「已经在跑」
 * 的这一轮——build 与发送链共享 JS 线程与单 SQLite 连接，曾把 POST
 * 派发从 +1.2s 拖到 +19.6s。**build 分段间 + build/resolve 关键边界检查**
 * （本类只覆盖 build 段与 build→resolve 之间的那道检查点；resolve 段内部的
 * 整串级重活由 core 抛 `PromptTokenResolveBailedError` 负责——三类弃权点在
 * chip 读口同款 catch 里收成同一个空串哨兵）命中即抛本错误，调用方
 * （chip 读口）捕获后按「保留旧标签」收场，不触发 fallback 重算。
 * 非 chip 消费方（预览等）不传 shouldBail，行为不变。
 */
export class ChatPromptBuildBailedError extends Error {
  constructor() {
    super('chat prompt build bailed (run in flight)');
    this.name = 'ChatPromptBuildBailedError';
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

/** 可见会话消息 + worktree/VFS 上下文 → 当前 Agent 的 LLM 输入。 */
export async function buildSessionPromptInput(
  runtime: MobileNovelMasterRuntime,
  scope: SessionPromptScope,
  definition?: AgentDefinition,
  options?: BuildSessionPromptInputOptions,
): Promise<SessionPromptInputBundle> {
  // 分段弃权 + 分段计时（__DEV__ 诊断，logcat 过滤 [nm-chip-build]；长期保留的诊断日志）：
  // 2026-09-30 回滚竞态里一次 build 墙钟 18.9s，靠分段读数定位被谁拖住。
  const shouldBail = options?.shouldBail;
  const diagT0 = __DEV__ ? Date.now() : 0;
  const bail = (): void => {
    if (shouldBail?.() === true) {
      throw new ChatPromptBuildBailedError();
    }
  };

  // 未预传入 definition 时才走 resolver（与 desktop 同款的短路逻辑），
  // 透传 scope.sessionId 让 core 解析链读到会话级绑定。
  const resolved =
    definition ??
    (await resolveAgentForProject(runtime, scope.projectId, scope.sessionId))
      .definition;
  bail();
  if (__DEV__) {
    console.log(`[nm-chip-build] agent +${Date.now() - diagT0}ms`);
  }

  // 只拉可见消息（SQL 层滤 hidden）：chip 的 prompt 组装只消费可见历史，
  // 大会话里 hidden（压缩/置位产物）往往占多数，全量拉回并逐条解压正文
  // 曾实测 700+ 条会话秒级卡顿。rawMessages 透传给 resolve 的回填参数已
  // 废弃（仅签名兼容），可见口径对其无影响。
  const visibleMessages = await runtime.messages.listBySession(
    scope.sessionId,
    {includeHidden: false},
  );
  bail();
  if (__DEV__) {
    console.log(`[nm-chip-build] messages(n=${visibleMessages.length}) +${Date.now() - diagT0}ms`);
  }
  const wtScope = {
    kind: 'session' as const,
    projectId: scope.projectId,
    sessionId: scope.sessionId,
  };
  const wt = runtime.workplace(wtScope);
  const vfs = runtime.sessionVfs(scope.projectId, scope.sessionId);
  // assemble → prepare(S0)，与 agent-runner 同源。workplace 段内部按文件粒度
  // 挂分段弃权判据（2026-09-30「16s 原子组装段」治本的同款下沉）：run 起步后
  // 本刷新在第一个文件边界就死；中止错误就地转抛 build 的统一哨兵类，读口
  // catch 的判定不变。fingerprint 透传给 ctx——token 估算读数的记忆缓存靠它
  // 免掉重复序列化/计数。
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
      {shouldStop: () => shouldBail?.() === true},
    );
  } catch (error) {
    if (error instanceof WorkplaceAssemblyAbortedError) {
      throw new ChatPromptBuildBailedError();
    }
    throw error;
  }
  const {workplaceDisplay, files: workplaceFiles, prefixPaths, visiblePaths, fingerprint} = assembled;
  bail();
  if (__DEV__) {
    console.log(`[nm-chip-build] workplace +${Date.now() - diagT0}ms`);
  }
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
  if (__DEV__) {
    console.log(`[nm-chip-build] prepare +${Date.now() - diagT0}ms`);
  }
  const ctx: PromptRenderContext = {
    workplaceDisplay,
    messages,
    workplace: wt,
    vfs,
    // 结构化文件清单（预览侧 workplace 二级卡数据源）：组装顺产直通。
    workplaceFiles,
    workplaceFingerprint: fingerprint,
  };
  const input = await buildPromptLlmInputFromLayout(resolved.prompts, ctx);
  if (__DEV__) {
    console.log(`[nm-chip-build] layout +${Date.now() - diagT0}ms`);
  }
  return {
    definition: resolved,
    layout: resolved.prompts,
    ctx,
    input,
    rawMessages: visibleMessages,
  };
}
