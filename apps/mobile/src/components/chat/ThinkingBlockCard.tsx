/**
 * Collapsible model reasoning (thinking block), separate from the reply bubble.
 */
import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  text: string;
  /** When true, card starts expanded (e.g. live streaming). */
  defaultExpanded?: boolean;
};

export function ThinkingBlockCard({text, defaultExpanded = false}: Props) {
  const {tokens} = useTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: tokens.bgSecondary,
          borderColor: tokens.borderLight,
        },
      ]}>
      <Pressable
        style={styles.header}
        onPress={() => setExpanded(v => !v)}
        accessibilityRole="button"
        accessibilityState={{expanded}}>
        <Text style={[styles.title, {color: tokens.textSecondary}]}>
          思考过程
        </Text>
        <Text style={[styles.chevron, {color: tokens.textTertiary}]}>
          {expanded ? '▼' : '▶'}
        </Text>
      </Pressable>
      {expanded ? (
        <Text style={[styles.body, {color: tokens.textSecondary}]}>
          {trimmed}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    maxWidth: '85%',
    marginVertical: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {fontSize: 12, fontWeight: '600'},
  chevron: {fontSize: 10},
  body: {fontSize: 13, lineHeight: 19},
});
