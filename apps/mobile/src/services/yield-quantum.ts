/**
 * 量子化让步原语：一次性大计算（水合、快照分片构建等长循环）按时间量子
 * 让出事件循环，防止 JS 线程被长期霸占导致 ANR / 交互卡死。
 *
 * 模式与 TDBC op-sqlite 连接的 runAdapter（packages/tdbc-driver-op-sqlite/
 * src/connection.ts）同款：防 ANR 只需事件循环不被长期剥夺，逐次
 * await setTimeout(0) 会让大批量小步骤每步都付一次定时器往返；量子化后
 * 让步次数从 O(步数) 降到 O(总时长/intervalMs)，ANR 防护等价、开销摊薄
 * 到可忽略。
 *
 * 用法：调用方持有 createQuantumYield() 返回的零参让步函数，在循环体内
 * await 它即可——距上次真实让步不足 intervalMs 时同步直通（不安排任何
 * 定时器），跨窗才真正 await setTimeout(0) 并以让步完成时刻重置窗口。
 *
 * 测试注入：构造参数 intervalMs 供测试替换计时行为——传 0 使每次调用
 * 都跨窗让步（fake timers 下逐次 advance(0) 即可推进，无需真实定时器）；
 * 传极大值使所有调用同步直通（等价于使用方经构造参数注入同步 resolve
 * 的 yield mock，调用方零参、测试面收窄到构造处）。默认 16ms 即生产取值。
 */
export function createQuantumYield(intervalMs = 16): () => Promise<void> {
  let lastYieldAt = Date.now();
  return async () => {
    const now = Date.now();
    if (now - lastYieldAt >= intervalMs) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      lastYieldAt = Date.now();
    }
  };
}
