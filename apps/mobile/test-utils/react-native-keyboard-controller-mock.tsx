import React from 'react';
import { View } from 'react-native';

export function KeyboardProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function KeyboardStickyView({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

export function KeyboardAvoidingView({
  children,
  style,
  ...rest
}: {
  children?: React.ReactNode;
  style?: unknown;
  [key: string]: unknown;
}) {
  return (
    <View style={style as never} {...rest}>
      {children}
    </View>
  );
}

// 测试注入用：默认 0（与真实环境键盘收起时一致），既有用例不注入则行为不变。
// useAdaptiveKeyboardSheetStyle 的测试靠它驱动键盘高度变化（配合 reanimated
// mock 的 useAnimatedStyle 直接执行 factory，样式即普通对象可断言）。
let keyboardHeightForTests = 0;

/** 仅测试用：注入键盘高度（弹起传负值，与真实 hook 语义一致）。 */
export function __setKeyboardHeightForTests(height: number) {
  keyboardHeightForTests = height;
}

export function useReanimatedKeyboardAnimation() {
  return {
    height: {value: keyboardHeightForTests},
    progress: {value: 0},
  };
}

export function useKeyboardAnimation() {
  return {
    height: {value: keyboardHeightForTests},
    progress: {value: 0},
  };
}

export function useKeyboardState<T = { height: number }>(
  selector?: (state: { height: number; isVisible: boolean }) => T,
): T {
  const state = { height: 0, isVisible: false };
  return (selector ? selector(state) : state) as T;
}

export function useGenericKeyboardHandler() {}

export function useKeyboardHandler() {}

export function useResizeMode() {}
