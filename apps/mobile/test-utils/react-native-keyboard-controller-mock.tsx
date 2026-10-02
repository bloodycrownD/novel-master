import React from 'react';
import {View} from 'react-native';
import {notifyAnimatedValuesChanged} from './animated-value-registry';

export function KeyboardProvider({children}: {children: React.ReactNode}) {
  return <>{children}</>;
}

export function KeyboardStickyView({children}: {children: React.ReactNode}) {
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
// mock 的 useAnimatedStyle 直接执行 factory，样式即普通对象可断言）；
// 键盘态派生（如 useChatComposerController 的 keyboardUp）靠它驱动
// useAnimatedReaction —— 写入后广播变更，见 animated-value-registry 模块头。
//
// **共享值对象必须跨渲染存活**（与真 reanimated 的 SharedValue 同语义）：若每次调用
// `useReanimatedKeyboardAnimation` 都现造一个 `{value: 快照}`，那么渲染时捕获的那个
// 对象里的 `.value` 就永远停在渲染那一刻——`useAnimatedReaction` 的 prepare 读到的是
// 旧快照，值翻转永远不触发。上面「跨渲染存活」这句不是洁癖，是这条链能不能被测的唯一前提。
let keyboardHeightForTests = 0;
const keyboardHeightSV = {value: 0};
const keyboardProgressSV = {value: 0};

/** 仅测试用：注入键盘高度（弹起传负值，与真实 hook 语义一致）。 */
export function __setKeyboardHeightForTests(height: number) {
  keyboardHeightForTests = height;
  keyboardHeightSV.value = height;
  notifyAnimatedValuesChanged();
}

export function useReanimatedKeyboardAnimation() {
  return {
    height: keyboardHeightSV,
    progress: keyboardProgressSV,
  };
}

export function useKeyboardAnimation() {
  return {
    height: keyboardHeightSV,
    progress: keyboardProgressSV,
  };
}

export function useKeyboardState<T = {height: number}>(
  selector?: (state: {height: number; isVisible: boolean}) => T,
): T {
  const state = {height: 0, isVisible: false};
  return (selector ? selector(state) : state) as T;
}

export function useGenericKeyboardHandler() {}

export function useKeyboardHandler() {}

export function useResizeMode() {}
