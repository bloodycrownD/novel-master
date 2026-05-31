/**
 * Themed single- or multi-line text input for form cards.
 */
import React from 'react';
import {StyleSheet, TextInput, type TextInputProps} from 'react-native';
import type {ThemeTokens} from '../../theme/tokens';

type Props = TextInputProps & {
  tokens: ThemeTokens;
  multiline?: boolean;
};

export function FormTextInput({tokens, style, multiline, ...rest}: Props) {
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
        style,
      ]}
      placeholderTextColor={tokens.textSecondary}
      multiline={multiline}
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
});
