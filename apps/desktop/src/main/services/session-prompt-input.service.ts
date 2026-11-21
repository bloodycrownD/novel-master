/**
 * Builds {@link PromptLlmInput} for current agent + session (real prompt / token count).
 */
import { AgentProjectResolver, type AgentDefinition } from "@novel-master/core/agent";
import { type AppError } from "@novel-master/core/errors";
import { Result, type Interrupt } from "@novel-master/core/errors";
import { PromptAssembler } from "@novel-master/core/chat";
import { PromptBuilder, type AgentPromptLayout, type PromptLlmInput, type PromptRenderContext } from "@novel-master/core/prompt";
import { WorkplaceDisplayAssembler } from "@novel-master/core/workplace";
import type { ChatMessageData } from "@novel-master/core/chat";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

export interface SessionPromptScope {
  readonly projectId: string;
  readonly sessionId: string;
}

interface PromptBuildOptions {
  /** 分段间防御性退出判定；真值即返回 null 哨兵（弃权，error-matrix-final R3）。 */
  readonly shouldBail?: () => boolean;
}

export interface SessionPromptInputBundle {
  readonly definition: AgentDefinition;
  readonly layout: AgentPromptLayout;
  readonly ctx: PromptRenderContext;
  readonly input: PromptLlmInput;
  /**
   * 可见消息列表（SQL 层已滤 hidden）：读口本地重算（
   * `CurrentPromptTokens.resolve`）直接消费，避免再开一次查询；resolve 侧
   * 的回填参数已废弃，可见口径不影响任何消费方。
   */
  readonly rawMessages: readonly ChatMessageData[];
}

/** null = build 分段弃权（run 在途，调用方保留旧标签）；弃权走返回值不走异常（error-matrix-final R3）。 */
type PromptInputResult = Promise<Result<SessionPromptInputBundle | null, AppError>>;

export namespace SessionPromptInputService {
  /**
   * Desktop prompt-input adapter：把 desktop runtime（messages / workplace / sessionKkv /
   * skills）适配到 core 的 assemble + PromptAssembler + PromptBuilder。已知失败沿
   * `Result.err`；分段弃权（run 在途）返回 `Result.ok(null)`——弃权是数据不是错误，
   * 调用方判 null 保留旧标签（error-matrix-final R3：异常哨兵退役）。
   */
  export async function buildAdapter(runtime: DesktopNovelMasterRuntime, scope: SessionPromptScope, definition?: AgentDefinition, options?: PromptBuildOptions): PromptInputResult {
    // 分段弃权：每段之间看一眼「run 是不是已经起步了」。mobile 真机实锤过
    // 这条链会把 POST 派发从 +1.2s 拖到 +19.6s（build 与发送链抢同一条 SQLite
    // 连接），desktop main 是同进程同连接，问题一模一样。
    const shouldBail = options?.shouldBail;
    const bailed = (): boolean => shouldBail?.() === true;

    // 错误通道迁移四期：AgentProjectResolver.resolve 沿 Result 回传，Err 直接并进本
    // 函数的 Result 通道（token 读口已有 resilient 降级、预览侧有 ipcErr 收口）。
    let resolved: AgentDefinition;
    if (definition != null) {
      resolved = definition;
    } else {
      const resolvedAgent = await AgentProjectResolver.resolve(runtime, scope.projectId, scope.sessionId);
      if (!resolvedAgent.ok) return Result.err(resolvedAgent.error);
      resolved = resolvedAgent.value.definition;
    }
    if (bailed()) return Result.ok(null);

    // 只拉可见消息（SQL 层滤 hidden）：chip 的 prompt 组装只消费可见历史，
    // 大会话里 hidden（压缩/置位产物）往往占多数，全量拉回并逐条解压正文
    // 在大会话上是秒级卡顿（与 mobile 同款修法）。
    // 分片判停复用 build 的弃权判据（shouldBail）：run 起步后读口在第一个分片
    // 边界就死，不必等整份可见历史 parse 完；中断返回 null 哨兵。
    const readOptions = shouldBail == null ? undefined : { checkpoint: (): Interrupt | null => (shouldBail() === true ? { kind: "replaced" } : null) };
    const visibleRead = await runtime.messages.listBySession(scope.sessionId, { includeHidden: false }, readOptions);
    if (visibleRead.kind === "failed") return Result.err(visibleRead.error);
    if (visibleRead.kind !== "completed") return Result.ok(null);
    const visibleMessages = visibleRead.value;
    if (bailed()) return Result.ok(null);
    const wtScope = {
      kind: "session" as const,
      projectId: scope.projectId,
      sessionId: scope.sessionId,
    };
    const wt = runtime.workplace(wtScope);
    const vfs = runtime.sessionVfs(scope.projectId, scope.sessionId);
    // assemble → prepare(S0)，与 agent-runner 同源。workplace 段内部按文件粒度
    // 挂分段弃权判据（2026-09-30 mobile「16s 原子组装段」治本的同款下沉）：
    // run 起步后本刷新在第一个文件边界就死；中止沿 Outcome.cancelled/replaced
    // 返回，此处映射 null 哨兵，读口判 null 的口径不变（error-matrix-final R3）。
    // fingerprint 透传给 ctx——token 估算读数的记忆缓存靠它免掉
    // 重复序列化/计数。
    const workplaceArgs = { sessionKkv: runtime.sessionKkv, workplace: wt, vfs, layout: resolved.prompts };
    const assembleOptions = { checkpoint: (): Interrupt | null => (shouldBail?.() === true ? { kind: "replaced" } : null) };
    const assembled = await WorkplaceDisplayAssembler.assemble(wtScope, workplaceArgs, assembleOptions);
    if (assembled.kind === "failed") {
      // 组装内的已知失败（如路径解析）沿 Result 返回（错误通道迁移四期），
      // 不吞成弃权；收口在 token 读口的 resilient（err → fallback 降级）与
      // preview 的 handlePromptRealPreview（ipcErr + formatIpcError）。
      return Result.err(assembled.error);
    }
    if (assembled.kind !== "completed") {
      return Result.ok(null);
    }
    const { workplaceDisplay, files: workplaceFiles, prefixPaths, visiblePaths, fingerprint } = assembled.value;
    if (bailed()) return Result.ok(null);
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
    const prepared = await PromptAssembler.prepare(visibleMessages, prepareRuntime);
    if (!prepared.ok) return Result.err(prepared.error);
    const messages = prepared.value;
    if (bailed()) return Result.ok(null);
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
}
