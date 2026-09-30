import React from 'react';
import {View} from 'react-native';

const Animated = {
  View,
  createAnimatedComponent: (Component: unknown) => Component,
};

export default Animated;

export function useAnimatedStyle(factory: () => object) {
  return typeof factory === 'function' ? factory() : {};
}

/**
 * shared value 桩：**只在首次渲染写一次初值，之后永不回写**。
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
