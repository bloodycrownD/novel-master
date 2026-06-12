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
  const hasDescription = description != null && description !== '';
  return (
    <View style={[styles.row, hasDescription && styles.rowWithDescription]}>
      <View style={styles.textCol}>
        <Text style={[styles.label, {color: tokens.text}]}>{label}</Text>
        {hasDescription ? (
          <Text style={[styles.description, {color: tokens.textSecondary}]}>
            {description}
          </Text>
        ) : null}
      </View>
      <View style={styles.switchWrap}>
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{false: tokens.border, true: tokens.primary}}
        />
      </View>
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
  rowWithDescription: {
    alignItems: 'flex-start',
  },
  textCol: {flex: 1, gap: 4},
  label: {fontSize: 16, fontWeight: '500'},
  description: {fontSize: 13, lineHeight: 18},
  switchWrap: {
    flexShrink: 0,
    paddingTop: 2,
  },
});
