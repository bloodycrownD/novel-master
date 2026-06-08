/**
 * Collapsible read-only tool group embedded in assistant bubbles (no menu).
 */
import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';
import type {ToolCallView} from './message-blocks';
import {ToolCallCard} from './ToolCallCard';

type Props = {
  tools: readonly ToolCallView[];
  embedded?: boolean;
  dimmed?: boolean;
  defaultExpanded?: boolean;
  onOpenFile?: (path: string) => void;
  showDividerBelow?: boolean;
};

export function ToolCallGroupCard({
  tools,
  embedded = true,
  dimmed = false,
  defaultExpanded = false,
  onOpenFile,
  showDividerBelow = false,
}: Props) {
  const {tokens} = useTheme();
  const hasPending = tools.some(tool => tool.status === 'pending');
  const [expanded, setExpanded] = useState(defaultExpanded || hasPending);

  if (tools.length === 0) {
    return null;
  }

  return (
    <View
      style={[
        embedded ? styles.embedded : styles.card,
        !embedded && {
          backgroundColor: tokens.bgSecondary,
          borderColor: tokens.borderLight,
        },
        {opacity: dimmed ? 0.55 : 1},
        showDividerBelow &&
          expanded && {
            borderBottomColor: tokens.borderLight,
            borderBottomWidth: StyleSheet.hairlineWidth,
            marginBottom: 8,
            paddingBottom: 8,
          },
      ]}>
      <Pressable
        style={styles.header}
        onPress={() => setExpanded(v => !v)}
        accessibilityRole="button"
        accessibilityState={{expanded}}>
        <Text style={[styles.title, {color: tokens.textSecondary}]}>
          工具调用 ({tools.length})
          {hasPending ? ' · 执行中' : ''}
        </Text>
        <Text style={[styles.chevron, {color: tokens.textTertiary}]}>
          {expanded ? '▼' : '▶'}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={styles.items}>
          {tools.map(tool => (
            <ToolCallCard
              key={tool.toolUseId}
              tool={tool}
              groupItem
              onOpenFile={onOpenFile}
            />
          ))}
        </View>
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
  embedded: {
    alignSelf: 'stretch',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {fontSize: 12, fontWeight: '600'},
  chevron: {fontSize: 10},
  items: {marginTop: 6, gap: 6},
});
