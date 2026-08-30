/**
 * Collapsible card for one real-prompt preview segment (default collapsed for perf).
 */
import React, {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {CollapsibleCard} from '@/components/ui/CollapsibleCard';
import {useTheme} from '../../theme/ThemeProvider';

const ROLE_LABEL: Record<string, string> = {
  system: '系统',
  user: '用户',
  assistant: '助手',
  tool: '工具',
};

function segmentTitleLabel(title: string): string {
  if (title === 'system') {
    return ROLE_LABEL.system;
  }
  if (title === 'skills') {
    return '技能索引';
  }
  return title;
}

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
    <CollapsibleCard
      title={
        <>
          <Text
            style={[styles.role, {color: tokens.primary}]}
            numberOfLines={1}
          >
            {roleLabel}
          </Text>
          <Text style={[styles.title, {color: tokens.text}]} numberOfLines={1}>
            {segmentTitleLabel(segment.title)}
          </Text>
        </>
      }
      summary={
        <View>
          <Text
            style={[styles.preview, {color: tokens.textSecondary}]}
            numberOfLines={2}
          >
            {collapsedHint}
          </Text>
          {charCount > 0 ? (
            <Text style={[styles.charCount, {color: tokens.textSecondary}]}>
              {charCount} 字
            </Text>
          ) : null}
        </View>
      }
      style={[
        styles.card,
        {
          backgroundColor: tokens.surface,
          borderColor: tokens.borderLight,
        },
      ]}
      headerStyle={styles.header}
      chevronStyle={styles.chevron}
    >
      <Text style={[styles.body, {color: tokens.text}]} selectable>
        {segment.body || '（空）'}
      </Text>
    </CollapsibleCard>
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
    alignItems: 'flex-start',
  },
  role: {fontSize: 12, fontWeight: '700', marginBottom: 2},
  title: {fontSize: 13, fontWeight: '600', marginBottom: 4},
  preview: {fontSize: 12, lineHeight: 17},
  charCount: {fontSize: 12, lineHeight: 17, marginTop: 2},
  chevron: {fontSize: 10, paddingTop: 4},
  body: {
    marginTop: 10,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
});
