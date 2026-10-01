import React from 'react';
import {View} from 'react-native';
import {subscribeAnimatedValues} from './animated-value-registry';

const Animated = {
  View,
  createAnimatedComponent: (Component: unknown) => Component,
};

export default Animated;

export function useAnimatedStyle(factory: () => object) {
  return typeof factory === 'function' ? factory() : {};
}

/**
 * 共享值桩：**只在首次渲染写一次初值，之后永不回写**。
 *
 * 与真 reanimated 的 `useSharedValue` 同语义——它返回的是同一个跨渲染存活的对象，
 * 值的推进只能靠 `.value = ...` 显式赋值。若这里每次 render 返回新 `{value}`，
 * 就等于把「真值驱动视觉」退化成「直读 state」：组件里删掉
 * `heightAV.value = withTiming(...)` 整行，样式断言照样绿（animatedStyle 每次
 * 渲染都从新对象里读到最新值），动画驱动这条线零覆盖。故此处必须用 ref 固定。
 */
export function useSharedValue<T>(value: T) {
  const ref = React.useRef({value});
  return ref.current;
}

/**
 * UI 线程 reaction 桩（真 reanimated 的 `useAnimatedReaction` 同形）。
 *
 * 驱动方式有两条：
 * 1. 每次 commit 后在 effect 里求值一次（覆盖「重渲染带来的值变化」）；
 * 2. 订阅 `animated-value-registry` 的变更通知（覆盖「值变了但组件没重渲染」——
 *    这正是键盘 SharedValue 每帧推进、而我们**刻意不**让它驱动重渲染的场景；
 *    没有这条，`useChatComposerController` 的 keyboardUp 用例就只能靠
 *    「手动 re-render」这种真机上不存在的动作来翻转）。
 *
 * 首帧只记录基线不回调（对齐真 reanimated：首帧 previous 为 null，reaction 收到
 * null 后由业务自己决定要不要上报——controller 正是这么判的）。
 */
export function useAnimatedReaction<T>(
  prepare: () => T,
  react: (current: T, previous: T | null) => void,
  _deps?: readonly unknown[],
): void {
  const prevRef = React.useRef<{value: T; seeded: boolean} | null>(null);
  const reactRef = React.useRef(react);
  reactRef.current = react;

  const evaluate = React.useCallback(() => {
    const next = prepare();
    const prev = prevRef.current;
    if (prev == null) {
      prevRef.current = {value: next, seeded: true};
      return;
    }
    if (prev.seeded && Object.is(prev.value, next)) {
      return;
    }
    const previous = prev.seeded ? prev.value : null;
    prevRef.current = {value: next, seeded: true};
    reactRef.current(next, previous);
  }, [prepare]);

  React.useEffect(() => {
    evaluate();
  });

  React.useEffect(() => subscribeAnimatedValues(evaluate), [evaluate]);
}

/** UI 线程 → JS 线程过桥桩：jest 里没有真正的线程边界，直接透传。 */
export function runOnJS<T extends (...args: never[]) => unknown>(fn: T): T {
  return fn;
}

export function useAnimatedProps(factory: () => object) {
  return typeof factory === 'function' ? factory() : {};
}

/**
 * 动画驱动的空桩：jest 不跑动画时间轴，`withTiming` 直接返回终值——
 * 组件在目标值上一次性落位（与显式读终值的断言口径一致）。
 */
export function withTiming<T>(value: T) {
  return value;
}

export function withSpring<T>(value: T) {
  return value;
}

export function withDelay<T>(_delay: number, value: T) {
  return value;
}

/** 缓动函数桩：只保证调用链不断（`Easing.out(Easing.quad)` 形态）。 */
export const Easing = {
  out: (fn: (t: number) => number) => fn,
  in: (fn: (t: number) => number) => fn,
  inOut: (fn: (t: number) => number) => fn,
  quad: (t: number) => t,
  cubic: (t: number) => t,
  ease: (t: number) => t,
};
