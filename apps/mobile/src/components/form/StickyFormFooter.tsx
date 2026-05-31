/**
 * Bottom save bar for full-screen forms.
 */
import React from 'react';
import {StyleSheet, View} from 'react-native';
import {PrimaryButton} from '../ui/PrototypeButtons';
import type {ThemeTokens} from '../../theme/tokens';

type Props = {
  tokens: ThemeTokens;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
};

export function StickyFormFooter({
  tokens,
  label,
  onPress,
  disabled,
  loading,
}: Props) {
  return (
    <View
      style={[
        styles.footer,
        {
          backgroundColor: tokens.surface,
          borderTopColor: tokens.borderLight,
        },
      ]}>
      <PrimaryButton
        label={loading ? '保存中…' : label}
        tokens={tokens}
        onPress={onPress}
        disabled={disabled || loading}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
