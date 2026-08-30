/**
 * Elevated card wrapping a form section (aligned with list cards / prototype).
 */
import React, {type ReactNode} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {ThemeTokens} from '@/theme/tokens';
import {card, cardSurface} from '@/components/ui/card-styles';

type Props = {
  title?: string;
  tokens: ThemeTokens;
  rightAction?: ReactNode;
  hint?: string;
  children?: ReactNode;
};

export function FormSectionCard({
  title,
  tokens,
  rightAction,
  hint,
  children,
}: Props) {
  return (
    <View
      style={[
        card,
        cardSurface(tokens),
      ]}
    >
      {title != null || rightAction != null ? (
        <View style={styles.header}>
          {title != null ? (
            <Text style={[styles.title, {color: tokens.text}]}>{title}</Text>
          ) : (
            <View style={styles.flex} />
          )}
          {rightAction ?? null}
        </View>
      ) : null}
      {hint != null ? (
        <Text style={[styles.hint, {color: tokens.textSecondary}]}>{hint}</Text>
      ) : null}
      {children != null ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  flex: {flex: 1},
  title: {fontSize: 17, fontWeight: '600'},
  hint: {fontSize: 13, lineHeight: 18, marginBottom: 12},
  body: {gap: 10},
});
