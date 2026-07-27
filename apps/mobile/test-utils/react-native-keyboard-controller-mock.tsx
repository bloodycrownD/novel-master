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

export function useReanimatedKeyboardAnimation() {
  return {
    height: { value: 0 },
    progress: { value: 0 },
  };
}

export function useKeyboardAnimation() {
  return {
    height: { value: 0 },
    progress: { value: 0 },
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
