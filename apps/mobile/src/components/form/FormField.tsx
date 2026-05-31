/**
 * Label + optional hint + field control.
 */
import React, {type ReactNode} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {ThemeTokens} from '../../theme/tokens';

type Props = {
  label: string;
  tokens: ThemeTokens;
  hint?: string;
  children: ReactNode;
};

export function FormField({label, tokens, hint, children}: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, {color: tokens.textSecondary}]}>{label}</Text>
      {hint != null ? (
        <Text style={[styles.hint, {color: tokens.textTertiary}]}>{hint}</Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {gap: 6},
  label: {fontSize: 13, fontWeight: '500'},
  hint: {fontSize: 12, lineHeight: 16},
});
