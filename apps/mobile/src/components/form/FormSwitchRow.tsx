/**
 * Form switch row inside a form card.
 */
import React from 'react';
import {StyleSheet, Switch, Text, View} from 'react-native';
import type {ThemeTokens} from '../../theme/tokens';

type Props = {
  label: string;
  tokens: ThemeTokens;
  value: boolean;
  onValueChange: (value: boolean) => void;
  description?: string;
  disabled?: boolean;
};

export function FormSwitchRow({
  label,
  tokens,
  value,
  onValueChange,
  description,
  disabled = false,
}: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.textCol}>
        <Text style={[styles.label, {color: tokens.text}]}>{label}</Text>
        {description != null ? (
          <Text style={[styles.description, {color: tokens.textSecondary}]}>
            {description}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{false: tokens.border, true: tokens.primary}}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
  },
  textCol: {flex: 1, gap: 4},
  label: {fontSize: 16, fontWeight: '500'},
  description: {fontSize: 13, lineHeight: 18},
});
