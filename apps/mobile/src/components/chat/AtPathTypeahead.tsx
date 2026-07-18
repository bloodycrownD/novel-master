/**
 * 手输 `@` typeahead：最多 5 条；点选插入完整 `@path`。
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { AtPathRef } from './composer-at-path';
import { formatComposerAtPathToken } from './composer-at-path';

export type AtPathTypeaheadProps = {
  open: boolean;
  candidates: readonly AtPathRef[];
  onSelect: (token: string) => void;
};

export function AtPathTypeahead({
  open,
  candidates,
  onSelect,
}: AtPathTypeaheadProps) {
  const { tokens } = useTheme();
  if (!open || candidates.length === 0) {
    return null;
  }
  return (
    <View
      style={[
        styles.list,
        { backgroundColor: tokens.surface, borderColor: tokens.border },
      ]}
      accessibilityLabel="文件路径建议"
    >
      {candidates.map(ref => {
        const token = formatComposerAtPathToken(ref.path, ref.kind === 'dir');
        const label = ref.kind === 'dir' ? `📁${ref.path}/` : `📄${ref.path}`;
        return (
          <Pressable
            key={`${ref.kind}:${ref.path}`}
            style={styles.item}
            onPress={() => onSelect(token)}
          >
            <Text style={{ color: tokens.text }} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 4,
  },
  item: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
