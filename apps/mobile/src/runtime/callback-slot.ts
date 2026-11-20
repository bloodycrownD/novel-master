/**
 * 单槽回调：`set` 写入当次回调、`take` 读取并清空（读后即清，防串台）。
 *
 * 适用场景是 React Navigation 的「函数不进路由参数」范式：push 前把回调写进
 * 模块级槽，目标屏挂载时读走。路由参数要求可序列化，函数放进 params 会在
 * 状态持久化 / 深链解析时被丢弃并触发 "Non-serializable values" 警告，所以
 * 回调/大载荷只能走模块级单例。
 *
 * 三处消费（file-editor-saved-callback / prompt-editor-callback /
 * prompt-turn-callback）原先各写一份 `let x: T | null` + 两个自由函数；
 * 本文件是那份「单槽 + take 清空」不变量的唯一实现。
 *
 * 与 {@link createRebootWaiterSlot} 的分工：那个槽要挂多个等待方并做代际
 * 校验，形状刻意贴合 `useRef` 的 `{current}`；本槽只有「一次一个、读完即清」
 * 语义，直接暴露 `set` / `take` 两个闭包。
 *
 * @module runtime/callback-slot
 */

/** 单槽回调的存取面；`take` 后槽回到空态。 */
export interface CallbackSlot<T> {
  /** 写入当次回调（覆盖上一次未取走的值）。 */
  set(callback: T): void;
  /** 读取并清空槽；空槽返回 null。 */
  take(): T | null;
}

export const CallbackSlot = {
  create: <T>(): CallbackSlot<T> => {
    let callback: T | null = null;
    return {
      set(next) {
        callback = next;
      },
      take() {
        const taken = callback;
        callback = null;
        return taken;
      },
    };
  },
} as const;
