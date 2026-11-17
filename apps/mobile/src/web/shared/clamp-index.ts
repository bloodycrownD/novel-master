/**
 * 文本偏移夹取：把外部传入的索引夹进 `[0, length]`（非有限值落 `length`）。
 *
 * code-editor 与 composer-input 两个 WebView 运行时共用（签名审计十五期：
 * 两份逐字相同的私有实现）。纯函数，无 Preact / DOM / RN 依赖。
 */
export function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) {
    return length;
  }
  return Math.max(0, Math.min(Math.floor(value), length));
}
