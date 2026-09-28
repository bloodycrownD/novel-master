/**
 * 句子级固定切分器——token 块缓存（message-token-cache）的切分基础。
 *
 * 纯函数、无内部状态：同一段文本任意时刻切出**完全相同的块序列**——这是
 * 内容寻址缓存正确性的前提（切分点漂移 = 缓存永远 miss）。规则变更会使
 * 全部旧块 hash 失活，属预期行为（缓存自然重算，无需迁移）；golden 测试
 * 锁定版本行为。
 *
 * 切分规则（优先级从高到低）：
 * ① 句末符号收尾成块，并**贪吃**紧随其后的连续句末符号（避免空块/碎块）；
 * ② 块长达到 {@link MAX_CHUNK_CHARS} 上限时，回退到块内**最近的软边界**
 *    （标点/空白，含入块尾）——软边界即 BPE 天然切点，误差最小；
 * ③ 块内无任何软边界时按上限**硬切**（无空白长中文串的病态输入由此兜住，
 *    保证后续逐块 encode 恒 ≤64 字符，防 O(len²)）。
 *
 * 实测依据（2026-09-28，用户真实备份库 23 会话）：P50 块长 24~50 字符、
 * ③ 兜底触发率 0.3%~8.9%；块分块计数 vs 整串 encode 误差 -0.02%~+0.35%。
 * 验证脚本原型：主仓 `tmp/token-cache-probe/verify-chunks.mjs`。
 */

/** 单块字符数硬上限：与增量计数器 MAX_ENCODE_CHARS 对齐（每次 encode ≤64）。 */
export const MAX_CHUNK_CHARS = 64;

/** 句末符号：出现即收尾成块（贪吃连续出现，含入块尾）。 */
export const SENTENCE_END_CHARS: ReadonlySet<string> = new Set([
  "。", "！", "？", "!", "?", "；", ";", "…", "\n", "\r", ">", "」", "』",
]);

/** 软边界：超限回退时的次选切点（CJK/ASCII 标点与空白，含入块尾）。 */
export const SOFT_BOUNDARY_CHARS: ReadonlySet<string> = new Set([
  "，", "、", ",", ".", ":", "：", "）", ")", "】", "]", "}", "》",
  "\"", "'", "“", "”", "‘", "’", " ", "\t", "—", "·", "%", "/", "\\", "|",
]);

/**
 * 把整段文本切成 ≤{@link MAX_CHUNK_CHARS} 字符的块序列。
 *
 * 不变量（测试锁定）：
 * - `splitTextIntoChunks(text).join("") === text`（划分，不增不删一字节）；
 * - 每块长度恒 ≤ 64；
 * - 同输入双调用结果逐项相等（确定性）；
 * - 空串返回空数组。
 */
export function splitTextIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  const n = text.length;
  let start = 0;
  let i = 0;
  let lastSoft = -1;
  while (i < n) {
    const ch = text[i]!;
    if (SENTENCE_END_CHARS.has(ch)) {
      // 贪吃连续句末符号（如 "……" / "\n\n" / "。。"）
      let end = i + 1;
      while (end < n && SENTENCE_END_CHARS.has(text[end]!)) end++;
      chunks.push(text.slice(start, end));
      start = end;
      lastSoft = -1;
      i = end;
      continue;
    }
    if (SOFT_BOUNDARY_CHARS.has(ch)) lastSoft = i;
    if (i - start + 1 >= MAX_CHUNK_CHARS) {
      if (lastSoft >= start) {
        chunks.push(text.slice(start, lastSoft + 1));
        start = lastSoft + 1;
      } else {
        chunks.push(text.slice(start, i + 1));
        start = i + 1;
      }
      lastSoft = -1;
    }
    i++;
  }
  if (start < n) chunks.push(text.slice(start));
  return chunks;
}
