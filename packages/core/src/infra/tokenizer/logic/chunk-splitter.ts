/**
 * 句子级固定切分器。
 *
 * 纯函数、无内部状态：同一段文本任意时刻切出**完全相同的块序列**——这是
 * 内容寻址缓存正确性的前提（切分点漂移 = 缓存永远 miss）。规则变更会使
 * 全部旧块 hash 失活，属预期行为（缓存自然重算，无需迁移）；golden 测试
 * 锁定版本行为。
 * ⚠️ 当前 `splitTextIntoChunks` **无生产消费方**：`infra/tokenizer/index.ts` 与
 *    `public/provider.ts` 只是 barrel 转发；消费它的只有测试
 *    （`token-chunk-cache.test.ts` 的 `countRound` 逐块算 `chunkHash16` 等）。
 *    而 `token-chunk-cache.ts` 自己 `import { hashContent }`，**并不调用**本函数。
 *    ⇒ 「切分点漂移 = 缓存永远 miss」这条因果链今天没有任何生产代码承受（测试面承受）。
 *    TODO：若 `token-chunk-cache` 真接上本函数，须在同一 PR 里补上贪吃段的二次切分。
 *
 * 切分规则（优先级从高到低）：
 * ① 句末符号收尾成块，并**贪吃**紧随其后的连续句末符号（避免空块/碎块）；
 * ② 块长达到 {@link MAX_CHUNK_CHARS} 上限时，回退到块内**最近的软边界**
 *    （标点/空白，含入块尾）——软边界即 BPE 天然切点，误差最小；
 * ③ 块内无任何软边界时按上限**硬切**（无空白长中文串的病态输入由此兜住，
 *    防 O(len²)）。
 *    ⚠️ 规则②③保证块长 ≤64；**规则①的贪吃段不受该上限约束**——句末符连续输入
 *    （如 `"。".repeat(200)`）会产出单个 200 字符的块。这是被 golden 用例
 *    `chunk-splitter.test.ts` 「连续句末贪吃」锁定的设计（贪吃是为避免空块/碎块），
 *    不是 bug；调用方若需要硬上限须自行二次切分。
 *
 * 实测依据（2026-09-28，用户真实备份库 23 会话）：P50 块长 24~50 字符、
 * ③ 兜底触发率 0.3%~8.9%；块分块计数 vs 整串 encode 误差 -0.02%~+0.35%。
 * 验证脚本原型：主仓 `tmp/token-cache-probe/verify-chunks.mjs`。
 */

/** 单块字符数上限（规则②③适用）；规则①的贪吃段可超出，见文件头。 */
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
 * 把整段文本切成不超过 {@link MAX_CHUNK_CHARS} 字符（规则②③）或一个贪吃句末段
 * （规则①）的块序列。
 *
 * 不变量（测试锁定）：
 * - `splitTextIntoChunks(text).join("") === text`（划分，不增不删一字节）；
 * - **除规则①的贪吃段外**，每块长度 ≤ {@link MAX_CHUNK_CHARS}
 *   （⚠️ 不是「恒 ≤64」——贪吃段按设计可超限，见文件头与 T-TC1-E1/E2）；
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
