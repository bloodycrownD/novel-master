/**
 * Elevated list row card (aligned with session cards / examples/mobile .agent-item).
 * 基础样式来自 card-styles 单源（cr-fix-spec comp-rest/C-7）。
 */
import React, {type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type {ThemeTokens} from '@/theme/tokens';
import {cardRow} from './card-styles';

type Props = {
  children: ReactNode;
  onPress: () => void;
  tokens: ThemeTokens;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function ElevatedCard({
  children,
  onPress,
  tokens,
  selected = false,
  style,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({pressed}) => [
        cardRow,
        {
          backgroundColor: tokens.surfaceElevated,
          borderColor: selected ? tokens.primary : tokens.borderLight,
          borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
          opacity: pressed ? 0.92 : 1,
        },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}
