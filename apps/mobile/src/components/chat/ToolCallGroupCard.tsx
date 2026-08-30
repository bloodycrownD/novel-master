/**
 * Collapsible read-only tool group embedded in assistant bubbles (no menu).
 */
import React from 'react';
import {StyleSheet, Text} from 'react-native';
import {CollapsibleCard} from '@/components/ui/CollapsibleCard';
import {useTheme} from '@/theme/ThemeProvider';
import type {SkillToolRef} from '@novel-master/core/chat';
import type {ToolCallView} from './message-blocks';
import {ToolCallCard} from './ToolCallCard';

type Props = {
  tools: readonly ToolCallView[];
  embedded?: boolean;
  dimmed?: boolean;
  defaultExpanded?: boolean;
  onOpenFile?: (path: string) => void;
  /** 点击 task 工具卡片时，跳转到对应子会话只读浏览页。 */
  onOpenSubagentSession?: (sessionId: string) => void;
  /** skill 卡片点击跳技能详情。 */
  onOpenSkillDetail?: (ref: SkillToolRef) => void;
  showDividerBelow?: boolean;
};

export function ToolCallGroupCard({
  tools,
  embedded = true,
  dimmed = false,
  defaultExpanded = false,
  onOpenFile,
  onOpenSubagentSession,
  onOpenSkillDetail,
  showDividerBelow = false,
}: Props) {
  const {tokens} = useTheme();

  if (tools.length === 0) {
    return null;
  }

  return (
    <CollapsibleCard
      defaultExpanded={defaultExpanded}
      title={
        <Text style={[styles.title, {color: tokens.textSecondary}]}>
          工具调用 ({tools.length})
        </Text>
      }
      style={[
        embedded ? styles.embedded : styles.card,
        !embedded && {
          backgroundColor: tokens.bgSecondary,
          borderColor: tokens.borderLight,
        },
        {opacity: dimmed ? 0.55 : 1},
      ]}
      contentStyle={styles.items}
      showDividerBelow={showDividerBelow}
    >
      {tools.map(tool => (
        <ToolCallCard
          key={tool.toolUseId}
          tool={tool}
          groupItem
          onOpenFile={onOpenFile}
          onOpenSubagentSession={onOpenSubagentSession}
          onOpenSkillDetail={onOpenSkillDetail}
        />
      ))}
    </CollapsibleCard>
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
  title: {fontSize: 12, fontWeight: '600'},
  items: {marginTop: 6, gap: 6},
});
