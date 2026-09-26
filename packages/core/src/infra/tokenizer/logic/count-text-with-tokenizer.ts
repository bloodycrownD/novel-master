/**
 * 「计数整段文本」的真分词器入口（stream-metrics-native ④）：把所有**字符折算
 * 兜底**（`ceil(字符数 / 3.35)`）统一换成真分词器计数。
 *
 * 为什么折算必须下台（实测，Node v22 + js-tiktoken 1.0.21 / cl100k_base）：
 * - 3.35 是**英文**口径（cl100k 英文约 3.5~3.6 字符/token）。中文实际约
 *   **1.64 字符/token**，折算对中文正文系统性**低估 82%~84%**（反向对英文高估
 *   66%）。这已经不是「精度不够」，而是「拿一个 80% 量级的偏差去卡上下文阈值」；
 * - 真分词器与真值的误差在 0.5% 量级（中文 +0.24%~+0.34%），是**降一个数量级**
 *   的差别而非优化。
 *
 * 为什么**用增量计数器**而不是直接全量 `encode`（本模块存在的理由）：
 * cl100k 的预分词正则会把**无空白长串**整体视作一个 piece，BPE 合并退化成近似
 * O(len²)。实测同一段文本：
 * - 全量 `encode`：8K 纯中文无空白串 **32.8s**、12K **93s**；而正常文本很快
 *   （8K 中文 69ms、30K 中文 266ms、30K 英文 6ms）——**「正常快、畸形态炸」**；
 * - 「整段喂进增量计数器」：30K 中文 273ms，与全量 encode（266ms）**打平**；
 *   病态档 12K 字符只要 491ms，**快 189 倍**。
 * 换句话说：增量计数器在「正常文本」上不比全量 encode 差，却把病态档从分钟级
 * 拉回亚秒级，因此它是**唯一**能同时覆盖两类输入的统一实现路径。
 *
 * 附带不变量：增量计数器内部把待编码段按 ≤64 字符切段（见
 * {@link createIncrementalTokenCounter}），所以**本函数的每一次 `encode` 入参
 * 恒 ≤64 字符**，调用方不必再为「编码器被喂超长串」做防御。
 *
 * 失败语义沿用计数器自身：不可编码的段按 1:1 上界兜底计入，`tokens` 单调不减、
 * 不抛错。**唯一的额外收口**：非空文本读出 0 时改按「1 字符 ≈ 1 token」兜底
 * （见函数体注释），因为「计数」的语义里非空文本返回 0 必然是错的。
 *
 * @module infra/tokenizer/logic/count-text-with-tokenizer
 */

import {
  createIncrementalTokenCounter,
  type IncrementalTokenCounter,
} from "./incremental-token-counter.js";

/**
 * 用真分词器（由调用方以 `encode` 注入）计一段文本的 token 数。
 *
 * 「喂整段文本进增量计数器」是这里唯一的实现：既有 `createIncrementalTokenCounter`
 * 的尾窗/边界固化逻辑，也顺带拿到「单次 encode ≤64 字符」的不变量（见模块头）。
 *
 * @param encode 真实编码器（真 tiktoken / js-tiktoken 均可）；抛错表示该段不可
 *   编码，由计数器按 1:1 上界兜底计入、读数不倒退。
 * @param text 待计数文本；空串返回 0。
 * @returns token 数（估算值，误差实测 ≤0.6%）。
 */
export function countTextWithIncrementalTokenizer(
  encode: (text: string) => number,
  text: string,
): number {
  if (text.length === 0) {
    return 0;
  }
  const counter: IncrementalTokenCounter = createIncrementalTokenCounter({
    encode,
  });
  counter.push(text);
  const counted = counter.tokens;
  // 一次性调用与流式用法的关键差异：计数器的「尾窗读值失败」分支返回的是**上一次
  // 成功读值**（流式下≈累计值，合理），而本函数只读一次，那个「上一次」是 0 ——
  // 于是「整段都不可编码」会安静地返回 0，把调用方（压缩阈值 / 占用标签）骗成
  // 「上下文是空的」。非空文本读出 0 在计数语义下必然是错的，这里按计数器自身
  // 同一条「宁可高估也不丢段」的 1:1 上界兜底，与固化路径的失败处理保持一致。
  return counted > 0 ? counted : text.length;
}
