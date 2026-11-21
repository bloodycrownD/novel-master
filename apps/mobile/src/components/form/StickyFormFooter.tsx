/**
 * Bottom save bar for full-screen forms.
 */
import React from 'react';
import {coreT} from '@/i18n/core';
import {StyleSheet, View} from 'react-native';
import {PrimaryButton} from '@/components/ui/Buttons';
import type {ThemeTokens} from '@/theme/tokens';

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
      ]}
    >
      <PrimaryButton
        label={loading ? coreT({key: "ui.common.saving"}) : label}
        tokens={tokens}
        onPress={onPress}
        disabled={disabled || loading}
        fullWidth
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
