/**
 * Primary / secondary buttons aligned with examples/mobile prototype.
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
          backgroundColor: tokens.surface,
          borderColor: tokens.primary,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
      ]}>
      <Text style={[styles.secondaryText, {color: tokens.primary}]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  secondary: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  secondaryText: {
    fontSize: 15,
    fontWeight: '600',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
});
