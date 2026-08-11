/**
 * 压缩执行器：直调化的 hide-message + kkv 清理 + token cache 失效。
 *
 * 本模块把原先散落在 `event-orchestrator.service.ts`（kkv 清理 + token cache 失效）
 * 与 `hide-message.handler.ts`（hide-message action）里的逻辑收拢成一个入口，
 * 让 agent-runner / 手动压缩不再绕事件编排器。
 *
 * 行为口径与旧路径完全一致：
 * 1. 按 `hideStartDepth` 构造 open-ended depth slice，调用 hide-message；
 * 2. 成功后清 session kkv 的 `rule_snapshot` + `file_cache` 两个域（保留 `user_vfs_pending`）；
 * 3. 失效该会话的 prompt token 进程内缓存。
 *
 * @module service/compaction-conditions/run-compaction
 */

import { runHideMessageAction } from "@/service/compaction-conditions/hide-message.action.js";
import type { DepthSlice } from "@/domain/depth/logic/depth-slice.js";
import { DEFAULT_HIDE_START_DEPTH } from "@/domain/compaction-conditions/model/compaction-conditions.js";
import {
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import { sessionApiPromptTokenCache } from "@/infra/tokenizer/logic/session-api-prompt-token-cache.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { MessageTranscriptEffectsService } from "@/service/chat/message-transcript-effects.port.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";

/** runCompaction 的运行时依赖（与事件编排器原先持有的那组服务同构）。 */
export interface RunCompactionDeps {
  readonly sessionKkv: SessionKkvService;
  readonly messages: MessageService;
  readonly messageTranscriptEffects: MessageTranscriptEffectsService;
}

/** runCompaction 的调用参数。 */
export interface RunCompactionParams {
  readonly sessionId: string;
  readonly projectId: string;
  /** hide-message 起始深度（tail 0 = newest），缺省按 {@link DEFAULT_HIDE_START_DEPTH}。 */
  readonly hideStartDepth?: number;
}

/** 压缩执行结果：只关心成败，不暴露 failures 细节。 */
export interface RunCompactionResult {
  readonly ok: boolean;
}

/**
 * 执行一次压缩：hide-message → 清 rule_snapshot/file_cache → 失效 prompt token cache。
 *
 * hide-message 抛异常时返回 `{ ok: false }`，不向上传播——与旧编排器
 * `emit()` 在 result.ok 为 false 时跳过 kkv 清理的语义一致（异常路径下不清缓存）。
 */
export async function runCompaction(
  deps: RunCompactionDeps,
  params: RunCompactionParams,
): Promise<RunCompactionResult> {
  const startDepth = params.hideStartDepth ?? DEFAULT_HIDE_START_DEPTH;
  const slice: DepthSlice = { startDepth };

  try {
    await runHideMessageAction(params.projectId, params.sessionId, slice, {
      messages: deps.messages,
      messageTranscriptEffects: deps.messageTranscriptEffects,
    });
  } catch {
    return { ok: false };
  }

  // hide-message 成功后才清缓存：与旧编排器 `result.ok` 门控同口径。
  await deps.sessionKkv.clearDomain(
    params.sessionId,
    SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
  );
  await deps.sessionKkv.clearDomain(
    params.sessionId,
    SESSION_KKV_DOMAIN_FILE_CACHE,
  );
  sessionApiPromptTokenCache.invalidate(params.sessionId);

  return { ok: true };
}
