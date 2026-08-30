/**
 * 手输 `@` typeahead：最多 5 条；点选插入完整 `@path`。
 */
import React from 'react';
import { Pressable, Text } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { TypeaheadList, typeaheadItemStyle } from './TypeaheadList';
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
    <TypeaheadList accessibilityLabel="文件路径建议">
      {candidates.map(ref => {
        const token = formatComposerAtPathToken(ref.path, ref.kind === 'dir');
        const label = ref.kind === 'dir' ? `📁${ref.path}/` : `📄${ref.path}`;
        return (
          <Pressable
            key={`${ref.kind}:${ref.path}`}
            style={typeaheadItemStyle}
            onPress={() => onSelect(token)}
          >
            <Text style={{ color: tokens.text }} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </TypeaheadList>
  );
}
