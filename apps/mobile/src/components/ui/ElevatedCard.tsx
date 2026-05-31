/**
 * Elevated list row card (aligned with session cards / examples/mobile .agent-item).
 */
import React, {type ReactNode} from 'react';
import {Pressable, StyleSheet, type StyleProp, type ViewStyle} from 'react-native';
import type {ThemeTokens} from '../../theme/tokens';

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
        styles.card,
        {
          backgroundColor: tokens.surfaceElevated,
          borderColor: selected ? tokens.primary : tokens.borderLight,
          borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
          opacity: pressed ? 0.92 : 1,
        },
        style,
      ]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 5,
    marginBottom: 12,
    padding: 16,
    borderRadius: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
});
