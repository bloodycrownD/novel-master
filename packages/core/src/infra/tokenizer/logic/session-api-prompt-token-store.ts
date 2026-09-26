/**
 * 会话级 API prompt 占用的持久化存取层：session KKV 编解码 + 进程内热层。
 *
 * 解决的问题：API 返回的 `promptTokens`（精确口径）原先只存在模块级 Map
 * （{@link sessionApiPromptTokenCache}），进程一退就丢。同一个读口
 * （`resolveCurrentPromptTokens`）重启前返回 API 值（`estimated:false`、
 * 标签不带 `~`），重启后 miss 跌回本地估算（带 `~`、且不数 tools 段），
 * 显示与压缩阈值判定双双跳口径。
 *
 * 本模块把值落到 session KKV 的 `prompt_tokens` 域：
 * - **热层**：进程内 Map 仍是第一读点——压缩评估每 step 都读 token 数，
 *   不能每步查库；KKV 只在 Map miss 时读一次并回填 Map。
 * - **降级**：KKV 行缺失 / JSON 损坏 / 字段类型不对 → 一律返回 null（当
 *   miss 处理，回退本地估算），不抛错、不造数。KKV 读失败（库异常）同样
 *   按 miss 处理并记 warn——本值是展示/判定派生值，不该把 run 打断。
 * - **失效**：{@link invalidateSessionApiPromptTokenEntry} 双删（Map + KKV），
 *   口径同 `persistFinalRateQuietly`：失效是 best-effort，失败只影响下次读数。
 *
 * 值 JSON：`{promptTokens, atMs, runId?, savedModelId?, lastMessageSeq?}`；
 * 可选字段缺失/非法即省略该键，旧格式值照常解析（向后兼容）。
 *
 * @module infra/tokenizer/logic/session-api-prompt-token-store
 */

import {
  PROMPT_TOKENS_LAST_USAGE_KEY,
  SESSION_KKV_DOMAIN_PROMPT_TOKENS,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import { sessionApiPromptTokenCache } from "./session-api-prompt-token-cache.js";

/**
 * 落库/回读一条 prompt 占用值所需的全部字段。
 *
 * `atMs` 是写入时刻（epoch 毫秒）：供「上次请求」标签与时效判定（例如
 * 未来若加 TTL）使用；`runId` / `savedModelId` / `lastMessageSeq` 是可选
 * 加固字段，缺失时消费方按「无指纹可比对」的兼容路径处理。
 */
export interface SessionApiPromptTokenEntry {
  readonly promptTokens: number;
  readonly atMs: number;
  readonly runId?: string;
  readonly savedModelId?: string;
  readonly lastMessageSeq?: number;
}

/** 可选加固字段：非空字符串 / 有限数才带上该键（缺省即旧格式值）。 */
function optionalRunId(runId: string | undefined): { runId?: string } {
  return runId != null && runId.length > 0 ? { runId } : {};
}

function optionalSavedModelId(
  savedModelId: string | undefined
): { savedModelId?: string } {
  return savedModelId != null && savedModelId.length > 0
    ? { savedModelId }
    : {};
}

function optionalLastMessageSeq(
  lastMessageSeq: number | undefined
): { lastMessageSeq?: number } {
  return typeof lastMessageSeq === "number" && Number.isFinite(lastMessageSeq)
    ? { lastMessageSeq }
    : {};
}

/** 序列化为 session KKV 值（紧凑 JSON）。 */
export function serializeSessionApiPromptTokenEntry(
  entry: SessionApiPromptTokenEntry
): string {
  return JSON.stringify({
    promptTokens: entry.promptTokens,
    atMs: entry.atMs,
    ...optionalRunId(entry.runId),
    ...optionalSavedModelId(entry.savedModelId),
    ...optionalLastMessageSeq(entry.lastMessageSeq),
  });
}

/**
 * 解析 session KKV 值；缺失/损坏/`promptTokens` 非有限数或为负 → null
 * （读口据此回退本地估算）。`atMs` 缺字段退化为 0；三个可选加固字段只
 * 在类型正确且非空时带上，旧格式值照常解析成功。
 */
export function parseSessionApiPromptTokenEntry(
  raw: string | null | undefined
): SessionApiPromptTokenEntry | null {
  if (raw == null || raw.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object") {
    return null;
  }
  const { promptTokens, atMs, runId, savedModelId, lastMessageSeq } =
    parsed as Partial<Record<keyof SessionApiPromptTokenEntry, unknown>>;
  if (
    typeof promptTokens !== "number" ||
    !Number.isFinite(promptTokens) ||
    promptTokens < 0
  ) {
    return null;
  }
  return {
    promptTokens,
    atMs: typeof atMs === "number" && Number.isFinite(atMs) ? atMs : 0,
    ...(typeof runId === "string" && runId.length > 0 ? { runId } : {}),
    ...(typeof savedModelId === "string" && savedModelId.length > 0
      ? { savedModelId }
      : {}),
    ...(typeof lastMessageSeq === "number" &&
    Number.isFinite(lastMessageSeq)
      ? { lastMessageSeq }
      : {}),
  };
}

/**
 * 读一条 prompt 占用值：进程内 Map 命中即返回（热路径零 IO）；miss 时读
 * session KKV 并回填 Map，让后续 step 的压缩评估走热层。
 *
 * `sessionKkv` 缺省（未装配 / 测试未注入）时退化为纯进程内读——调用方
 * 行为与落库前一致，不因缺装配而报错。
 */
export async function readSessionApiPromptTokenEntry(
  sessionKkv: SessionKkvService | null | undefined,
  sessionId: string
): Promise<SessionApiPromptTokenEntry | null> {
  const hot = sessionApiPromptTokenCache.get(sessionId);
  if (hot != null) {
    return {
      promptTokens: hot.promptTokens,
      atMs: hot.updatedAt,
      ...optionalRunId(hot.runId),
      ...optionalSavedModelId(hot.savedModelId),
      ...optionalLastMessageSeq(hot.lastMessageSeq),
    };
  }
  if (sessionKkv == null) {
    return null;
  }

  let raw: string | null;
  try {
    raw = await sessionKkv.get(
      sessionId,
      SESSION_KKV_DOMAIN_PROMPT_TOKENS,
      PROMPT_TOKENS_LAST_USAGE_KEY
    );
  } catch (error) {
    // 展示/判定派生值：库异常按 miss 处理，让读口回退本地估算，不打断 run。
    console.warn(
      `[novel-master/prompt-token-store] prompt token KKV 读取失败（session=${sessionId}），按 miss 处理`,
      error
    );
    return null;
  }

  const entry = parseSessionApiPromptTokenEntry(raw);
  if (entry == null) {
    return null;
  }
  sessionApiPromptTokenCache.set(sessionId, {
    promptTokens: entry.promptTokens,
    updatedAt: entry.atMs,
    ...optionalRunId(entry.runId),
    ...optionalSavedModelId(entry.savedModelId),
    ...optionalLastMessageSeq(entry.lastMessageSeq),
  });
  return entry;
}

/**
 * 写一条 prompt 占用值：同步写进程内热层，KKV 侧 fire-and-forget。
 *
 * KKV 写失败只记 warn——展示派生值，失败只丢「跨重启保持同一口径」这一
 * 好处（下一次 completed run 会重写），不该让 run 收尾链冒泡错误。
 */
export function writeSessionApiPromptTokenEntry(
  sessionKkv: SessionKkvService | null | undefined,
  sessionId: string,
  entry: SessionApiPromptTokenEntry
): void {
  sessionApiPromptTokenCache.set(sessionId, {
    promptTokens: entry.promptTokens,
    updatedAt: entry.atMs,
    ...optionalRunId(entry.runId),
    ...optionalSavedModelId(entry.savedModelId),
    ...optionalLastMessageSeq(entry.lastMessageSeq),
  });
  if (sessionKkv == null) {
    return;
  }
  void sessionKkv
    .set(
      sessionId,
      SESSION_KKV_DOMAIN_PROMPT_TOKENS,
      PROMPT_TOKENS_LAST_USAGE_KEY,
      serializeSessionApiPromptTokenEntry(entry)
    )
    .catch((error) => {
      console.warn(
        `[novel-master/prompt-token-store] prompt token KKV 写入失败（session=${sessionId}）`,
        error
      );
    });
}

/**
 * 失效一条 prompt 占用值：进程内 Map 与 session KKV 行双删。
 *
 * 凡改变「当前可见 prompt」或模型绑定、应丢弃陈旧 API 占用的路径，成功后
 * 必须调本函数。KKV 删除失败同样吞错记 warn（残留行会靠下一次 completed
 * run 覆盖，或靠会话删除整表清兜底）。
 */
export function invalidateSessionApiPromptTokenEntry(
  sessionKkv: SessionKkvService | null | undefined,
  sessionId: string
): void {
  sessionApiPromptTokenCache.invalidate(sessionId);
  if (sessionKkv == null) {
    return;
  }
  void sessionKkv
    .delete(
      sessionId,
      SESSION_KKV_DOMAIN_PROMPT_TOKENS,
      PROMPT_TOKENS_LAST_USAGE_KEY
    )
    .catch((error) => {
      console.warn(
        `[novel-master/prompt-token-store] prompt token KKV 删除失败（session=${sessionId}）`,
        error
      );
    });
}
