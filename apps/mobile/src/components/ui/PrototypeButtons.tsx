/**
 * Primary / Secondary 按钮，对齐 examples/mobile 原型紧凑样式。
 */
import React from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
import type {ThemeTokens} from '../../theme/tokens';

type BtnProps = {
  label: string;
  onPress: () => void;
  tokens: ThemeTokens;
  disabled?: boolean;
  fullWidth?: boolean;
};

export function PrimaryButton({
  label,
  onPress,
  tokens,
  disabled,
  fullWidth,
}: BtnProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({pressed}) => [
        styles.primary,
        fullWidth ? styles.fullWidth : null,
        {backgroundColor: tokens.primary, opacity: disabled ? 0.45 : pressed ? 0.85 : 1},
      ]}>
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  tokens,
  disabled,
  fullWidth,
}: BtnProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({pressed}) => [
        styles.secondary,
        fullWidth ? styles.fullWidth : null,
        {
          backgroundColor: tokens.bgSecondary,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
      ]}>
      <Text style={[styles.secondaryText, {color: tokens.text}]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  secondary: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontSize: 14,
    fontWeight: '600',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
});
