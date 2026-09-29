/**
 * chat token 标签 memo：重进会话「无变更即秒回」的进程内层。
 *
 * 背景（2026-09-29 真机实测）：计数链已全缓存（L1 整串 + KKV 持久化），
 * 但标签刷新仍要**重组装**整个提示词（拉可见消息 + 规则快照 + file_cache
 * 解压 + 序列化），725 消息/139KB 会话实测 ~0.7s——缓存省的是「数」，
 * 省不了「拼」。本 memo 用一枚廉价变更指纹（stamp）判定「重组装结果必然
 * 不变」，直接返回上次标签，组装/序列化/哈希全跳。
 *
 * stamp 组成（全部单行读，实测合计 ~20ms 量级）：
 * - 消息面：`sessionMessageStamp`（可见条数 + MAX(seq)）——append/编辑后
 *   追加/回滚删尾动 maxSeq；压缩/置位（hide）动 visibleCount；
 * - 会话行：`sessions.get().updatedAtMs`——消息编辑等不动条数的变更兜底；
 * - 模型面：`getSessionAgentConfig().modelId`——会话级换模型即失效；
 * - 规则面：rule_snapshot canon 的内容指纹——置位/压缩/导入/rule 刷新都会
 *   重写快照，canon 变化即失效；
 * - API 真值面：prompt_tokens 域条目的 atMs+值指纹——API 值写入/失效
 *   （run 收尾、invalidate）不必伴随消息面变化，读数档位（远程=/本地）随它切换。
 *
 * **已知盲区（拍板接受）**：agent 定义的 model pin、tokenizer override 设置
 * 这类「不改消息也不改会话行」的配置变更不在 stamp 内——命中旧标签直到下一
 * 次消息/模型/规则变更。这类变更是低频用户主动操作，且 agent 每次真跑一轮
 * 后必有消息变更自愈。
 *
 * @module infra/tokenizer/logic/chat-token-label-memo
 */

import { hashContent } from "@/domain/vfs/content-store/logic/hash-content.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import {
  RULE_SNAPSHOT_CANON_KEY,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import { readSessionApiPromptTokenEntry } from "./session-api-prompt-token-store.js";

/** stamp 依赖：双端 service 从各自 runtime 组装，全部单行读。 */
export interface ChatTokenLabelStampDeps {
  readonly sessions: {
    get(id: string): Promise<{ updatedAtMs: number }>;
  };
  readonly messages: {
    sessionMessageStamp(
      sessionId: string
    ): Promise<{ visibleCount: number; maxSeq: number | null }>;
  };
  readonly sessionKkv: SessionKkvService | null | undefined;
}

/** 会话级 memo 条数上限（会话删除不主动清，靠 LRU + stamp 失效兜底）。 */
const MEMO_MAX_SESSIONS = 8;

const memoBySession = new Map<string, { stamp: string; payload: unknown }>();

/** canon 指纹：完整 sha256 截 16 hex（canon 数十 KB 哈希 ~1ms）。 */
async function ruleCanonFingerprint(
  sessionKkv: SessionKkvService | null | undefined,
  sessionId: string
): Promise<string> {
  if (sessionKkv == null) {
    return "no-kkv";
  }
  try {
    const canon = await sessionKkv.get(
      sessionId,
      SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
      RULE_SNAPSHOT_CANON_KEY
    );
    return canon == null ? "empty" : hashContent(canon).slice(0, 16);
  } catch {
    return "read-error";
  }
}

/**
 * API 真值条目指纹。无 sessionKkv / 无条目 / 条目损坏 → "none"（
 * `readSessionApiPromptTokenEntry` 自身会把库读异常吞成 miss，与真缺失同路，
 * 指纹层面同样对待即可）；读取走 store 的进程内热层，重复调用近零成本。
 */
async function apiEntryFingerprint(
  sessionKkv: SessionKkvService | null | undefined,
  sessionId: string
): Promise<string> {
  if (sessionKkv == null) {
    return "no-kkv";
  }
  const entry = await readSessionApiPromptTokenEntry(sessionKkv, sessionId);
  return entry == null ? "none" : `${entry.atMs}:${entry.promptTokens}`;
}

/**
 * 计算会话的标签变更指纹。任一组成变化 → 重组装；全部不变 → memo 命中。
 * 组装失败按全变处理（抛错由调用方走完整路径，不吞）。
 */
export async function computeChatTokenLabelStamp(
  sessionId: string,
  deps: ChatTokenLabelStampDeps,
  sessionModelId: string | null | undefined
): Promise<string> {
  const [session, messageStamp, canonFp, apiFp] = await Promise.all([
    deps.sessions.get(sessionId),
    deps.messages.sessionMessageStamp(sessionId),
    ruleCanonFingerprint(deps.sessionKkv, sessionId),
    apiEntryFingerprint(deps.sessionKkv, sessionId),
  ]);
  return [
    `u${session.updatedAtMs}`,
    `v${messageStamp.visibleCount}`,
    `s${messageStamp.maxSeq ?? -1}`,
    `m${sessionModelId ?? ""}`,
    `r${canonFp}`,
    `a${apiFp}`,
  ].join("#");
}

/**
 * 标签 memo（进程内、会话级 LRU）。payload 双端形态不同（mobile 存拼好的
 * label 字符串、desktop 存完整 stats 响应对象），故为不透明载荷 + 读取侧
 * 泛型断言；命中要求 stamp 逐字相等。
 */
export const chatTokenLabelMemo = {
  get<T>(sessionId: string, stamp: string): T | null {
    const entry = memoBySession.get(sessionId);
    if (entry != null && entry.stamp === stamp) {
      // LRU 提升：删掉重插到最新端。
      memoBySession.delete(sessionId);
      memoBySession.set(sessionId, entry);
      return entry.payload as T;
    }
    return null;
  },

  set(sessionId: string, stamp: string, payload: unknown): void {
    memoBySession.delete(sessionId);
    memoBySession.set(sessionId, { stamp, payload });
    while (memoBySession.size > MEMO_MAX_SESSIONS) {
      const oldest = memoBySession.keys().next();
      if (oldest.done === true) {
        break;
      }
      memoBySession.delete(oldest.value);
    }
  },

  /** 测试用：清空全部 memo 条目。 */
  clearForTests(): void {
    memoBySession.clear();
  },
} as const;
