/**
 * Builds {@link PromptLlmInput} for current agent + session (real prompt / token count).
 */
import { type AgentDefinition, type AppError, resolveAgentForProject } from "@novel-master/core/agent";
import { Result } from "@novel-master/core/errors";
import { promptAssembler } from "@novel-master/core/chat";
import { PromptBuilder, type AgentPromptLayout, type PromptLlmInput, type PromptRenderContext } from "@novel-master/core/prompt";
import { assembleWorkplaceDisplay, type Interrupt } from "@novel-master/core/workplace";
import type { ChatMessageData } from "@novel-master/core/chat";
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
 * resolve 段内部的整串级重活由读口的边界检查点与 core 读口负责——错误通道
 * 迁移二期起 core 弃权沿 Outcome.cancelled/replaced 返回，读口就地转抛本
 * 哨兵收口，三类弃权点在读口同款 catch 里收成同一个 null 哨兵）命中即抛本
 * 错误，调用方（token 读口）捕获后按「保留旧标签」收场，**不触发 fallback
 * 重算**。
 *
 * 非读口消费方（预览 `prompt-preview.service` 等）不传 shouldBail，行为不变。
 */
export class ChatPromptBuildBailedError extends Error {
  constructor() {
    super("chat prompt build bailed (run in flight)");
    this.name = "ChatPromptBuildBailedError";
  }
}

interface PromptBuildOptions {
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

type PromptInputResult = Promise<Result<SessionPromptInputBundle, AppError>>;

export async function buildSessionPromptInput(runtime: DesktopNovelMasterRuntime, scope: SessionPromptScope, definition?: AgentDefinition, options?: PromptBuildOptions): PromptInputResult {
  // 分段弃权：每段之间看一眼「run 是不是已经起步了」。mobile 真机实锤过
  // 这条链会把 POST 派发从 +1.2s 拖到 +19.6s（build 与发送链抢同一条 SQLite
  // 连接），desktop main 是同进程同连接，问题一模一样。
  const shouldBail = options?.shouldBail;
  const bail = (): void => {
    if (shouldBail?.() === true) {
      throw new ChatPromptBuildBailedError();
    }
  };

  // 错误通道迁移四期：resolveAgentForProject 沿 Result 回传，Err 直接并进本
  // 函数的 Result 通道（token 读口已有 resilient 降级、预览侧有 ipcErr 收口）。
  let resolved: AgentDefinition;
  if (definition != null) {
    resolved = definition;
  } else {
    const resolvedAgent = await resolveAgentForProject(runtime, scope.projectId, scope.sessionId);
    if (!resolvedAgent.ok) return Result.err(resolvedAgent.error);
    resolved = resolvedAgent.value.definition;
  }
  bail();

  // 只拉可见消息（SQL 层滤 hidden）：chip 的 prompt 组装只消费可见历史，
  // 大会话里 hidden（压缩/置位产物）往往占多数，全量拉回并逐条解压正文
  // 在大会话上是秒级卡顿（与 mobile 同款修法）。
  // 分片判停复用 build 的弃权判据（shouldBail）：run 起步后读口在第一个分片
  // 边界就死，不必等整份可见历史 parse 完；中断转抛 build 的统一哨兵。
  const readOptions = shouldBail == null ? undefined : { checkpoint: (): Interrupt | null => (shouldBail() === true ? { kind: "replaced" } : null) };
  const visibleRead = await runtime.messages.listBySession(scope.sessionId, { includeHidden: false }, readOptions);
  if (visibleRead.kind === "failed") return Result.err(visibleRead.error);
  if (visibleRead.kind !== "completed") throw new ChatPromptBuildBailedError();
  const visibleMessages = visibleRead.value;
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
  // run 起步后本刷新在第一个文件边界就死；错误通道迁移二期起中止沿
  // Outcome.cancelled/replaced 返回，此处转抛 build 的统一哨兵，读口 catch
  // 的判定不变。fingerprint 透传给 ctx——token 估算读数的记忆缓存靠它免掉
  // 重复序列化/计数。
  const workplaceArgs = { sessionKkv: runtime.sessionKkv, workplace: wt, vfs, layout: resolved.prompts };
  const assembleOptions = { checkpoint: (): Interrupt | null => (shouldBail?.() === true ? { kind: "replaced" } : null) };
  const assembled = await assembleWorkplaceDisplay(wtScope, workplaceArgs, assembleOptions);
  if (assembled.kind === "failed") {
    // 组装内的已知失败（如路径解析）沿 Result 返回（错误通道迁移四期），
    // 不吞成弃权；收口在 token 读口的 resilient（err → fallback 降级）与
    // preview 的 handlePromptRealPreview（ipcErr + formatIpcError）。哨兵类
    // ChatPromptBuildBailedError 见 spec-3 §3.6（控制流保留，仍走 throw）。
    return Result.err(assembled.error);
  }
  if (assembled.kind !== "completed") {
    throw new ChatPromptBuildBailedError();
  }
  const { workplaceDisplay, files: workplaceFiles, prefixPaths, visiblePaths, fingerprint } = assembled.value;
  bail();
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
  const ctx: PromptRenderContext = {
    workplaceDisplay,
    messages,
    workplace: wt,
    vfs,
    // 结构化文件清单（预览侧 workplace 二级卡数据源）：组装顺产直通。
    workplaceFiles,
    workplaceFingerprint: fingerprint,
  };
  // 预览与 token 计数默认 agentStepIndex 为 0，含 once dynamic 块。
  // 四期签名：PromptBuilder.llmInput 沿 Result 回传，Err 并进本函数通道。
  const built = await PromptBuilder.llmInput(resolved.prompts, ctx);
  if (!built.ok) return Result.err(built.error);
  return Result.ok({ definition: resolved, layout: resolved.prompts, ctx, input: built.value, rawMessages: visibleMessages });
}
