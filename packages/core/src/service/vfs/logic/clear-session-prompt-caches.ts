/**
 * session scope 导入后的提示词缓存对齐四件套。
 *
 * 清空 `rule_snapshot` + `file_cache` 两域、失效 prompt token cache、
 * 失效工具调用数缓存（usage_stats.toolUseCount 写哨兵——导入可能带入
 * 含 tool_use 的消息，陈旧计数不得续命）。
 *
 * @module service/vfs/logic/clear-session-prompt-caches
 */

import {
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
  SESSION_KKV_DOMAIN_USAGE_STATS,
  USAGE_STATS_TOOL_USE_COUNT_KEY,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import { invalidateSessionApiPromptTokenEntry } from "@/infra/tokenizer/logic/session-api-prompt-token-store.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";

/**
 * 清空该 session 的 `rule_snapshot` + `file_cache` 两域，并失效 prompt token cache。
 *
 * 顺序与置位 / 压缩（run-compaction / message-transcript-effects）的三件套一致，
 * 但错误口径**有意不同**：这里整体 try/catch 吞错 + `console.warn`（best-effort）——
 * 调用时机是导入事务成功提交之后，文件已落库，缓存对齐失败只影响下一次提示词
 * 重评估，不应让导入报错；而置位 / 压缩清空失败意味着会话状态错乱，裸 await
 * 上抛是刻意的。
 */
export async function clearSessionPromptCaches(
  sessionId: string,
  sessionKkv: SessionKkvService
): Promise<void> {
  try {
    await sessionKkv.clearDomain(sessionId, SESSION_KKV_DOMAIN_RULE_SNAPSHOT);
    await sessionKkv.clearDomain(sessionId, SESSION_KKV_DOMAIN_FILE_CACHE);
    // API prompt 占用双删（进程内热层 + prompt_tokens 域行）：导入后提示词
    // 全变，落库的旧占用若残留会在重启后被读回、按 api 口径参与阈值判定。
    await invalidateSessionApiPromptTokenEntry(sessionKkv, sessionId);
    // 工具调用数缓存一并失效（导入可能带入含 tool_use 的消息，best-effort）。
    // 写哨兵空串而非 delete（cr-fix-spec-r2 s3/B-1：读口回填前按原值复核，
    // 哨兵与该协议配套）。
    await sessionKkv.set(
      sessionId,
      SESSION_KKV_DOMAIN_USAGE_STATS,
      USAGE_STATS_TOOL_USE_COUNT_KEY,
      ""
    );
  } catch (error) {
    console.warn(
      `clearSessionPromptCaches: best-effort 清空提示词缓存失败（session=${sessionId}）`,
      error
    );
  }
}
