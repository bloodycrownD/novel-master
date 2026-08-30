/**
 * session scope 导入后的提示词缓存对齐三件套。
 *
 * @module service/vfs/logic/clear-session-prompt-caches
 */

import {
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import { sessionApiPromptTokenCache } from "@/infra/tokenizer/logic/session-api-prompt-token-cache.js";
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
    sessionApiPromptTokenCache.invalidate(sessionId);
  } catch (error) {
    console.warn(
      `clearSessionPromptCaches: best-effort 清空提示词缓存失败（session=${sessionId}）`,
      error
    );
  }
}
