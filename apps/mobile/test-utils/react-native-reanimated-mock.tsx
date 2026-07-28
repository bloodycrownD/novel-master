import React from 'react';
import { View } from 'react-native';

const Animated = {
  View,
  createAnimatedComponent: (Component: unknown) => Component,
};

export default Animated;

export function useAnimatedStyle(factory: () => object) {
  return typeof factory === 'function' ? factory() : {};
}

export function useSharedValue<T>(value: T) {
  return { value };
}

export function useAnimatedProps(factory: () => object) {
  return typeof factory === 'function' ? factory() : {};
}
