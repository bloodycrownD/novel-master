/**
 * Themed single- or multi-line text input for form cards.
 */
import React from 'react';
import {StyleSheet, TextInput, type TextInputProps} from 'react-native';
import type {ThemeTokens} from '@/theme/tokens';

type Props = TextInputProps & {
  tokens: ThemeTokens;
  multiline?: boolean;
  /** 禁用态：不可输入并灰显（只读详情整表禁用用）。 */
  disabled?: boolean;
};

export function FormTextInput({
  tokens,
  style,
  multiline,
  disabled,
  editable,
  ...rest
}: Props) {
  return (
    <TextInput
      style={[
        styles.input,
        multiline ? styles.multiline : null,
        {
          color: tokens.text,
          backgroundColor: tokens.bgSecondary,
          borderColor: tokens.borderLight,
        },
        disabled ? styles.disabled : null,
        style,
      ]}
      placeholderTextColor={tokens.textSecondary}
      multiline={multiline}
      editable={disabled ? false : editable}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  multiline: {minHeight: 88, textAlignVertical: 'top'},
  // 与 FormSelectField 的禁用灰态同档（0.55）。
  disabled: {opacity: 0.55},
});
