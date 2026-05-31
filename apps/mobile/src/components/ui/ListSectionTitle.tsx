/**
 * Small section caption above grouped list cards.
 */
import React from 'react';
import {StyleSheet, Text} from 'react-native';
import type {ThemeTokens} from '../../theme/tokens';

type Props = {
  title: string;
  tokens: ThemeTokens;
};

export function ListSectionTitle({title, tokens}: Props) {
  return (
    <Text style={[styles.title, {color: tokens.textSecondary}]}>{title}</Text>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginHorizontal: 5,
    marginBottom: 8,
    marginTop: 4,
  },
});
