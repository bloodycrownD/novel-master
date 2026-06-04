/**
 * Collapsible card for one real-prompt preview segment (default collapsed for perf).
 */
import React, {useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';

const ROLE_LABEL: Record<string, string> = {
  system: '系统',
  user: '用户',
  assistant: '助手',
  tool: '工具',
};

export type PromptPreviewSegmentView = {
  readonly id: string;
  readonly role: string;
  readonly title: string;
  readonly body: string;
};

type Props = {
  segment: PromptPreviewSegmentView;
};

function previewLine(body: string): string {
  const line = body.replace(/\r\n/g, '\n').split('\n')[0]?.trim() ?? '';
  if (line.length <= 72) {
    return line;
  }
  return `${line.slice(0, 69)}…`;
}

export function PromptPreviewSegmentCard({segment}: Props) {
  const {tokens} = useTheme();
  const [expanded, setExpanded] = useState(false);
  const roleLabel = ROLE_LABEL[segment.role] ?? segment.role;
  const charCount = segment.body.length;
  const collapsedHint = useMemo(() => {
    if (charCount === 0) {
      return '空内容';
    }
    const line = previewLine(segment.body);
    return line.length > 0 ? line : `${charCount} 字`;
  }, [charCount, segment.body]);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: tokens.surface,
          borderColor: tokens.borderLight,
        },
      ]}>
      <Pressable
        style={styles.header}
        onPress={() => setExpanded(v => !v)}
        accessibilityRole="button"
        accessibilityState={{expanded}}>
        <View style={styles.headerText}>
          <Text style={[styles.role, {color: tokens.primary}]} numberOfLines={1}>
            {roleLabel}
          </Text>
          <Text style={[styles.title, {color: tokens.text}]} numberOfLines={1}>
            {segment.title}
          </Text>
          {!expanded ? (
            <Text
              style={[styles.preview, {color: tokens.textSecondary}]}
              numberOfLines={2}>
              {collapsedHint}
              {charCount > 0 ? ` · ${charCount} 字` : ''}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.chevron, {color: tokens.textTertiary}]}>
          {expanded ? '▼' : '▶'}
        </Text>
      </Pressable>
      {expanded ? (
        <Text
          style={[styles.body, {color: tokens.text}]}
          selectable>
          {segment.body || '（空）'}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  headerText: {flex: 1, minWidth: 0},
  role: {fontSize: 12, fontWeight: '700', marginBottom: 2},
  title: {fontSize: 13, fontWeight: '600', marginBottom: 4},
  preview: {fontSize: 12, lineHeight: 17},
  chevron: {fontSize: 10, paddingTop: 4},
  body: {
    marginTop: 10,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
});
