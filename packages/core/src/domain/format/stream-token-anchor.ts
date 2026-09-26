/**
 * 「基线 + 增量」token 读值的两个纯函数（stream-metrics-native ①）。
 *
 * 口径只有一条，双端各自内联写了一遍且命名不一致（mobile 叫
 * `baseTokens` / `reanchorBase`，desktop 直接内联算式）。本模块把这
 * 一条口径收敛成 core 的单点声明，双端 hook / 单元都调它——公式要改只
 * 改这一处。
 *
 * 读值恒等式：`composeStreamTokens(reanchorStreamTokenBase(t, i), i)
 * === max(0, t)`（见 `test/domain/format/stream-token-anchor.test.ts`）——
 * 重锚把 `t` 定成当下读值，之后同样的增量再叠一次仍读回 `t`。
 *
 * 纯函数、无副作用、不碰 DOM 与平台 API，故不进 `infra` 层。
 */

/**
 * 读值 = `max(0, 基线 + 增量估算)`。
 *
 * 夹负是「读值不得为负」的收敛点：usage 真值比已累计的增量小（校正点
 * 提前到达、模型重算等）时，基线 + 增量可能算出负数，读值一律夹到 0。
 */
export function composeStreamTokens(base: number, increment: number): number {
  return Math.max(0, base + increment);
}

/**
 * 重锚基线 = `真值 − 当前增量估算`。
 *
 * 校正点（usage 事件到达 / 启动水合回填）把 `truth` 定成此刻的读值，
 * 此后每个 delta 的增量继续叠加上去——多步 run 的数字因此单调增长，
 * 而不是冻结在上一 step 的真值上。
 */
export function reanchorStreamTokenBase(
  truth: number,
  increment: number,
): number {
  return truth - increment;
}
