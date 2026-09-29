import {View} from 'react-native';

const Animated = {
  View,
  createAnimatedComponent: (Component: unknown) => Component,
};

export default Animated;

export function useAnimatedStyle(factory: () => object) {
  return typeof factory === 'function' ? factory() : {};
}

export function useSharedValue<T>(value: T) {
  return {value};
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
