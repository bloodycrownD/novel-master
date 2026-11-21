/**
 * 跨端并发原语：互斥状态（计数式忙碌旗）与事件循环让步。
 *
 * desktop 的「数据清理 / 导入导出」与 mobile 的同名维护窗口、desktop 云同步的
 * 「pull/push 进行中」标志，此前三处各写一份 `let count` / `let bool` + 一组
 * 自由函数。本文件是那份「acquire/release 严格配对、`> 0` 即 busy、release
 * 钳到 0」不变量的唯一实现；各端模块只负责实例化，并按平台既有函数名再导出
 * （跨端镜像的是名字与文案，不是实现）。
 *
 * 计数语义（ic-20）：底层函数（备份导出/导入、云同步 snapshot 搬运）入口
 * acquire、出口 finally release 自平衡；最外层流程（备份导入 / 云同步 pull）
 * 在 rebootstrap 完成之后 release——含「库文件已替换、连接仍处重建窗口」的
 * 完整互斥。计数 >0 即 busy，多个调用方嵌套不会互相提前清位（纯布尔置位会被
 * 嵌套调用的外层复位提前解锁）。
 *
 * 让步原语 `yieldToEventLoop` 服务于「长循环按片让路」：每次调用排一个
 * `setTimeout(0)` 宏任务让出当前 tick。它与 mobile 的 `createQuantumYield`
 * 不同职责——那个按时间量子节流（窗口内同步直通），是移动端长计算的形态。
 *
 * @module common/concurrency
 */

/** 进程级忙碌旗：`> 0` 即忙碌；`release` 钳到 0，多释放不产生负计数。 */
interface BusyFlag {
  /** 是否有调用方正处在互斥窗口内。 */
  isBusy(): boolean;
  /** 计数 +1（与 `release` 严格配对使用）。 */
  acquire(): void;
  /** 计数 -1，下限 0（多释放不会把后续 acquire 提前抵消）。 */
  release(): void;
  /** 兼容旧布尔置位形态：true = acquire、false = release。 */
  set(busy: boolean): void;
  /** 测试用：复位计数。 */
  resetForTest(): void;
}

export const Concurrency = {
  /** 进程级忙碌旗工厂：`> 0` 即忙碌；`release` 钳到 0，多释放不产生负计数。 */
  createBusyFlag(): BusyFlag {
    let count = 0;
    // nm-style: keep-closure — count 是 BusyFlag 实例的隐藏计数状态（闭包生命周期=实例生命周期）；提升模块级会把 count 全局化破坏三端多实例语义，转 this-方法会把 count 暴露在公共 handle 上破坏封装。
    const acquire = () => {
      count += 1;
    };
    // nm-style: keep-closure — 与 acquire 同为 count 的互补动词（同一隐藏状态的严格配对），捕获集完全重叠但不构成可合并。
    const release = () => {
      count = Math.max(0, count - 1);
    };
    return {
      isBusy: () => count > 0,
      acquire,
      release,
      set: (busy) => (busy ? acquire() : release()),
      resetForTest: () => {
        count = 0;
      },
    };
  },

  /**
   * 片与片之间的事件循环让步（排一个 `setTimeout(0)` 宏任务）。
   *
   * RULE：让步**只能落在片与片之间，绝不能落在事务回调内部**（事务内语句须同步执行）。
   */
  yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  },
} as const;
