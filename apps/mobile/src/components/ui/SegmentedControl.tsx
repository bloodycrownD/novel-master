/**
 * Pill segmented control (examples/mobile .chat-top-tabs).
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {ThemeTokens} from '../../theme/tokens';

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  tokens: ThemeTokens;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  tokens,
}: Props<T>) {
  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: tokens.surfaceElevated,
          borderBottomColor: tokens.borderLight,
        },
      ]}>
      {options.map(option => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[
              styles.segment,
              active && {
                backgroundColor: tokens.primary,
                shadowColor: '#000',
                shadowOffset: {width: 0, height: 1},
                shadowOpacity: 0.08,
                shadowRadius: 3,
                elevation: 2,
              },
            ]}>
            <Text
              style={[
                styles.label,
                {color: active ? '#FFFFFF' : tokens.textSecondary},
              ]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
});
