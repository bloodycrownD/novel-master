/**
 * 「计数整段文本」的真分词器入口（stream-metrics-native ④）：把所有**字符折算
 * 兜底**（`ceil(字符数 / 3.35)`）统一换成真分词器计数。
 *
 * 为什么折算必须下台（实测，Node v22 + js-tiktoken 1.0.21 / cl100k_base）：
 * - 3.35 是**英文**口径（cl100k 英文约 3.5~3.6 字符/token）。中文实际约
 *   **≈1.64 token/字符（≈0.61 字符/token）**，折算对中文正文系统性**低估
 *   82%~84%**（反向对英文高估 66%）。这已经不是「精度不够」，而是「拿一个 80%
 *   量级的偏差去卡上下文阈值」；
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
 * 本函数与流式用法的构造口径**故意不同**：这里用
 * `tailChars: 0 / commitStepChars: 1` 把固化阈值收到 1 字符，全文逐段走**固化
 * 路径**。原因是流式场景留 24 字符尾窗是为了「读数贴合真值」，而本函数**只读
 * 一次值**，尾窗只剩一个「读值路径失败就回落上一次成功读值」的漏洞——那次「上
 * 一次」是 0，会把已固化的计数整段丢掉（实测 6,024 字符中文读出 0、真实值
 * 9,421，低估 36%）。收紧尾窗后，失败段一律走固化路径的「1 字符计 1 token」
 * 兜底且**不丢段**，读值路径事实上不再可能失败。
 *
 * 失败语义沿用计数器自身：不可编码的段**按 1 字符计 1 token**兜底计入，保证
 * 不丢段、读数不倒退，`tokens` 单调不减、不抛错。⚠️ **这不是上界**：cl100k 中文
 * 约 **1.64 token/字符**，1:1 只有真值的 0.61×，方向是**偏保守**而不是偏大。
 * **唯一的额外收口**：非空文本读出 0 时同样按「1 字符计 1 token」兜底（见函数
 * 体注释），因为「计数」的语义里非空文本返回 0 必然是错的。
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
 *   编码，由计数器按 1 字符计 1 token 兜底计入（保证不丢段、读数不倒退；⚠️ 对
 *   中文而言这个 1:1 仍可能**低于**真值，方向是偏保守、**不是上界**）。
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
  // 收紧尾窗到 `normalLimit = tailChars + commitStepChars = 1`：全文逐段走**固化
  // 路径**，失败段由固化路径「1 字符计 1 token」兜底且**不丢段**（不丢段这一点
  // 见 `incremental-token-counter.ts` 的 `commitOnce`）。循环结束后尾窗残留 ≤1
  // 字符——单字符不可能触发特殊 token，**读值路径实际不再可能失败**。
  const counter: IncrementalTokenCounter = createIncrementalTokenCounter({
    encode,
    tailChars: 0,
    commitStepChars: 1,
  });
  counter.push(text);
  const counted = counter.tokens;
  // belt-and-braces 兜底（不可达但保留）：一次性调用与流式用法的关键差异是——计数器
  // 的「尾窗读值失败」分支返回的是**上一次成功读值**（流式下≈累计值，合理），而本
  // 函数只读一次，那个「上一次」是 0；非空文本读出 0 在计数语义下必然是错，按同一
  // 条「1 字符计 1 token、不丢段、读数不倒退」的兜底收口。注意它是**保守**方向：
  // 对中文而言 1:1 只有真值的 0.61×，**不是上界**（模块头有完整口径）。
  return counted > 0 ? counted : text.length;
}
