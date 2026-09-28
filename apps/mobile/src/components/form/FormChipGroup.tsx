/**
 * Horizontal chip selector for enums / ids.
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {ThemeTokens} from '@/theme/tokens';

export type ChipOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

type Props<T extends string> = {
  tokens: ThemeTokens;
  options: ReadonlyArray<ChipOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** 整组禁用：所有 chip 禁点并灰显（只读详情整表禁用用）。 */
  disabled?: boolean;
};

export function FormChipGroup<T extends string>({
  tokens,
  options,
  value,
  onChange,
  disabled = false,
}: Props<T>) {
  return (
    <View style={styles.wrap}>
      {options.map(option => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            disabled={disabled || option.disabled}
            style={[
              styles.chip,
              {
                borderColor: active ? tokens.primary : tokens.borderLight,
                backgroundColor: active ? tokens.primary : tokens.bgSecondary,
                opacity:
                  disabled || (option.disabled && !active) ? 0.45 : 1,
              },
            ]}
            onPress={() => onChange(option.value)}
          >
            <Text style={{color: active ? '#FFFFFF' : tokens.text}}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
});
