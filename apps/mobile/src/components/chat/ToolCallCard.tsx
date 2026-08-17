/**
 * Tool invocation card with status from paired tool_result.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import {
  skillToolRef,
  toolCallSummary,
  vfsToolFilePath,
  type ToolCallView,
} from './message-blocks';
import type {SkillToolRef} from '@novel-master/core/chat';

type Props = {
  tool: ToolCallView;
  showFullParams?: boolean;
  /** Inline row inside ToolCallGroupCard (no outer list margins). */
  groupItem?: boolean;
  /** When set and tool has a VFS file path, the card is tappable. */
  onOpenFile?: (path: string) => void;
  /** 当 tool 带 subagentSessionId 时，点击跳转子会话只读浏览。 */
  onOpenSubagentSession?: (sessionId: string) => void;
  /** skill_opt 卡片点击跳技能详情（project 域缺 projectId 时由调用方补会话项目）。 */
  onOpenSkillDetail?: (ref: SkillToolRef) => void;
};

function statusLabel(status: ToolCallView['status']): string {
  switch (status) {
    case 'success':
      return '成功';
    case 'error':
      return '失败';
    case 'pending':
      return '执行中';
    case 'interrupted':
      return '已中断';
    default:
      return '';
  }
}

function statusColor(
  status: ToolCallView['status'],
  tokens: { primary: string; danger: string; textSecondary: string },
): string {
  if (status === 'error') {
    return tokens.danger;
  }
  if (status === 'pending' || status === 'interrupted') {
    return tokens.textSecondary;
  }
  return tokens.primary;
}

export function ToolCallCard({
  tool,
  showFullParams,
  groupItem = false,
  onOpenFile,
  onOpenSubagentSession,
  onOpenSkillDetail,
}: Props) {
  const { tokens } = useTheme();
  const filePath = vfsToolFilePath(tool);
  const subagentSessionId = tool.subagentSessionId;
  // skill_opt 跳转三元组：meta 透传优先，否则从 input 解析（write/edit）。
  // projectId 由最终导航方按会话上下文补齐，这里不传。
  const skillRef = onOpenSkillDetail != null ? skillToolRef(tool) : undefined;
  // canOpen 对称 vfs 文件路径：任一可跳转目标存在即视为可点。
  const canOpen =
    (filePath != null && onOpenFile != null) ||
    (subagentSessionId != null && onOpenSubagentSession != null) ||
    (skillRef != null && onOpenSkillDetail != null);
  const summary = toolCallSummary(tool);
  const detail = showFullParams ? JSON.stringify(tool.input, null, 2) : summary;
  const openHint =
    subagentSessionId != null
      ? '点击查看 · 子会话'
      : skillRef != null
        ? '点击查看 · 技能'
        : '点击查看 · 聊天工作区';

  const card = (
    <>
      <View style={styles.header}>
        <Text style={[styles.name, { color: tokens.text }]} numberOfLines={1}>
          {tool.name}
        </Text>
        <Text
          style={[styles.status, { color: statusColor(tool.status, tokens) }]}
        >
          {statusLabel(tool.status)}
        </Text>
      </View>
      {detail ? (
        <Text style={[styles.summary, { color: tokens.textSecondary }]}>
          {detail}
        </Text>
      ) : null}
      {canOpen ? (
        <Text style={[styles.openHint, { color: tokens.primary }]}>
          {openHint}
        </Text>
      ) : null}
    </>
  );

  if (canOpen) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          subagentSessionId != null
            ? `打开子会话 ${subagentSessionId}`
            : skillRef != null
              ? `打开技能 ${skillRef.name}`
              : `打开文件 ${filePath}`
        }
        onPress={() => {
          if (subagentSessionId != null && onOpenSubagentSession != null) {
            onOpenSubagentSession(subagentSessionId);
          } else if (skillRef != null && onOpenSkillDetail != null) {
            onOpenSkillDetail(skillRef);
          } else if (filePath != null && onOpenFile != null) {
            onOpenFile(filePath);
          }
        }}
        style={({ pressed }) => [
          groupItem ? styles.groupItem : styles.card,
          {
            backgroundColor: tokens.surface,
            borderColor: canOpen ? tokens.primary : tokens.border,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        {card}
      </Pressable>
    );
  }

  return (
    <View
      style={[
        groupItem ? styles.groupItem : styles.card,
        { backgroundColor: tokens.surface, borderColor: tokens.border },
      ]}
    >
      {card}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  groupItem: {
    alignSelf: 'stretch',
    width: '100%',
    padding: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  name: { flex: 1, fontWeight: '600', fontSize: 14 },
  status: { fontSize: 12, fontWeight: '500' },
  summary: { marginTop: 6, fontSize: 13 },
  openHint: { marginTop: 8, fontSize: 12, fontWeight: '500' },
});
