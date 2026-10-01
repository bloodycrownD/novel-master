/**
 * 测试注入用的「动画值变更」总线（`react-native-reanimated` / `react-native-keyboard-controller`
 * 两个 mock 之间的唯一耦合点）。
 *
 * 为什么需要它：真 reanimated 里 `useAnimatedReaction` 跑在 UI 线程、SharedValue 变化
 * 由动画时间轴推送，JS 侧无从插手。jest 不跑时间轴，若两个 mock 各写各的
 * （一个返回常量、一个只在自己 render 时求值），「键盘弹起 → keyboardUp 翻转」这条
 * 链在测试里就**永远不发生**，用例要么红、要么被写成「重新 render 就算翻转」这种
 * 与真机行为不符的假口径。
 *
 * 契约：keyboard-controller mock 的 `__setKeyboardHeightForTests` 写值后调
 * `notifyAnimatedValuesChanged()`；reanimated mock 的 `useAnimatedReaction` 订阅它，
 * 在通知里重跑一次 `prepare()` 并按「值真变了才回调」驱动 react。生产代码对此完全
 * 无感——它只看到 reanimated 的公开 API。
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** 通知所有订阅者：某个测试注入的动画值发生了变化。 */
export function notifyAnimatedValuesChanged(): void {
  // 复制一份再遍历：react 回调里可能 subscribe/unsubscribe（重挂场景），
  // 直接遍历 Set 会撞上「遍历中修改」。
  for (const listener of Array.from(listeners)) {
    listener();
  }
}

/** 订阅动画值变更；返回取消订阅函数。 */
export function subscribeAnimatedValues(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
