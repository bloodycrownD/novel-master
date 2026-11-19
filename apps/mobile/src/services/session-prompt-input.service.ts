/**
 * Builds {@link PromptLlmInput} for current agent + session (real prompt / token count).
 */
import {type AgentDefinition, AgentProjectResolver} from '@novel-master/core/agent';
import {ChatPromptBuildBailedError} from '@novel-master/core';

import {promptAssembler, type ChatMessageData} from '@novel-master/core/chat';
import {PromptBuilder, type AgentPromptLayout, type PromptLlmInput, type PromptRenderContext} from '@novel-master/core/prompt';
import {WorkplaceDisplayAssembler} from '@novel-master/core/workplace';
import {Result, AppError, type Interrupt} from '@novel-master/core/errors';
import type {MobileNovelMasterRuntime as MobileRuntime} from '@/runtime/types';

export interface SessionPromptScope {
  readonly projectId: string;
  readonly sessionId: string;
}

interface BuildSessionPromptInputOptions {
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
  readonly rawMessages: readonly ChatMessageData[];
}

/** 可见会话消息 + worktree/VFS 上下文 → 当前 Agent 的 LLM 输入。
 *
 * 失败通道（错误通道迁移四期）：组装/prepare 的已知失败沿 `Result.err` 接力
 * 给调用方；bail 弃权哨兵（{@link ChatPromptBuildBailedError}，控制流类）
 * 仍走 throw——调用方 chip 读口紧邻 catch 收成空串哨兵，判定不变。
 */
type SessionPromptInputResult = Promise<Result<SessionPromptInputBundle, AppError>>;

export async function buildSessionPromptInputAdapter(runtime: MobileRuntime, scope: SessionPromptScope, definition?: AgentDefinition, options?: BuildSessionPromptInputOptions): SessionPromptInputResult {
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
  let resolved: AgentDefinition;
  if (definition != null) {
    resolved = definition;
  } else {
    const r = await AgentProjectResolver.resolve(runtime, scope.projectId, scope.sessionId);
    if (!r.ok) return Result.err(r.error);
    resolved = r.value.definition;
  }
  bail();
  if (__DEV__) {
    console.log(`[nm-chip-build] agent +${Date.now() - diagT0}ms`);
  }

  // 只拉可见消息（SQL 层滤 hidden）：chip 的 prompt 组装只消费可见历史，
  // 大会话里 hidden（压缩/置位产物）往往占多数，全量拉回并逐条解压正文
  // 曾实测 700+ 条会话秒级卡顿。rawMessages 透传给 resolve 的回填参数已
  // 废弃（仅签名兼容），可见口径对其无影响。
  // 分片判停复用 build 的弃权判据（shouldBail）：run 起步后读口在第一个分片
  // 边界就死；中断转抛 build 的统一哨兵（与下方 assemble 同款收口）。
  const readOptions = shouldBail == null ? undefined : {checkpoint: (): Interrupt | null => (shouldBail() === true ? {kind: 'replaced'} : null)};
  const visibleRead = await runtime.messages.listBySession(scope.sessionId, {includeHidden: false}, readOptions);
  if (visibleRead.kind === 'failed') return Result.err(visibleRead.error);
  if (visibleRead.kind !== 'completed') throw new ChatPromptBuildBailedError();
  const visibleMessages = visibleRead.value;
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
  // 本刷新在第一个文件边界就死；错误通道迁移二期起中止沿 Outcome.cancelled/
  // replaced 返回，此处转抛 build 的统一哨兵，读口 catch 的判定不变。
  // fingerprint 透传给 ctx——token 估算读数的记忆缓存靠它免掉重复序列化/计数。
  const workplaceContext = {sessionKkv: runtime.sessionKkv, workplace: wt, vfs, layout: resolved.prompts};
  const stopOptions = {checkpoint: (): Interrupt | null => (shouldBail?.() === true ? {kind: 'replaced'} : null)};
  const assembled = await WorkplaceDisplayAssembler.assemble(wtScope, workplaceContext, stopOptions);
  if (assembled.kind === 'failed') {
    // 组装内的已知失败（如路径解析）：沿 Result 通道接力，不吞成弃权。
    return Result.err(assembled.error);
  }
  if (assembled.kind !== 'completed') {
    throw new ChatPromptBuildBailedError();
  }
  const {workplaceDisplay, files: workplaceFiles, prefixPaths, visiblePaths, fingerprint} = assembled.value;
  bail();
  if (__DEV__) {
    console.log(`[nm-chip-build] workplace +${Date.now() - diagT0}ms`);
  }
  const prepareRuntime = {
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
  };
  const prepared = await promptAssembler.prepare(visibleMessages, prepareRuntime);
  if (!prepared.ok) return Result.err(prepared.error);
  const messages = prepared.value;
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
  const inputResult = await PromptBuilder.llmInput(resolved.prompts, ctx);
  if (!inputResult.ok) return Result.err(inputResult.error);
  if (__DEV__) {
    console.log(`[nm-chip-build] layout +${Date.now() - diagT0}ms`);
  }
  return Result.ok({
    definition: resolved,
    layout: resolved.prompts,
    ctx,
    input: inputResult.value,
    rawMessages: visibleMessages,
  });
}
