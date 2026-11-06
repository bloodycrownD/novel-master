/**
 * 轻量内容哈希纯工具（双 32 位 FNV-1a 拼接 16 hex 小写）。
 *
 * 两个消费方：token 块缓存的内容寻址键段（`chunkHash16`）与日志正文摘要
 * （`describeText`）。刻意不用 sha256——Hermes 无 JIT 下每块一次 sha256 的
 * 固定开销是计数热路径的病根（详见 `token-chunk-cache.ts` 的 `chunkHash16`
 * 注释）；FNV-1a 是纯 Uint32 乘加，零转码零堆分配零 BigInt。
 *
 * @module common/hash
 */

const FNV_OFFSET_A = 0x811c9dc5;
const FNV_OFFSET_B = 0x9dc5811c;
const FNV_PRIME = 0x01000193;

/**
 * 双 FNV-1a（前向 + 反向、不同 offset）拼 64 bit，恒 16 位小写 hex。
 *
 * ⚠ 输出形态是 public 契约（L1/L2 键拼接、KKV payload 校验、日志指纹都硬
 * 依赖 16 hex 定长）：换实现必须保持形态；键值域变化须 bump 消费方的
 * payload 版本号。
 */
export function fnv1aHex16(text: string): string {
  let h1 = FNV_OFFSET_A;
  for (let i = 0; i < text.length; i++) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), FNV_PRIME) >>> 0;
  }
  let h2 = FNV_OFFSET_B;
  for (let i = text.length - 1; i >= 0; i--) {
    h2 = Math.imul(h2 ^ text.charCodeAt(i), FNV_PRIME) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
