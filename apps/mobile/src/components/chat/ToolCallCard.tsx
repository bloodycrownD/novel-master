/**
 * Tool invocation card with status from paired tool_result.
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '@/theme/ThemeProvider';
import {
  toolCallSummary,
  vfsToolFilePath,
  type ToolCallView,
} from './message-blocks';

type Props = {
  tool: ToolCallView;
  showFullParams?: boolean;
  /** Inline row inside ToolCallGroupCard (no outer list margins). */
  groupItem?: boolean;
  /** When set and tool has a VFS file path, the card is tappable. */
  onOpenFile?: (path: string) => void;
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
  tokens: {primary: string; danger: string; textSecondary: string},
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
}: Props) {
  const {tokens} = useTheme();
  const filePath = vfsToolFilePath(tool);
  const canOpen = filePath != null && onOpenFile != null;
  const summary = toolCallSummary(tool);
  const detail = showFullParams
    ? JSON.stringify(tool.input, null, 2)
    : summary;

  const card = (
    <>
      <View style={styles.header}>
        <Text style={[styles.name, {color: tokens.text}]} numberOfLines={1}>
          {tool.name}
        </Text>
        <Text
          style={[
            styles.status,
            {color: statusColor(tool.status, tokens)},
          ]}>
          {statusLabel(tool.status)}
        </Text>
      </View>
      {detail ? (
        <Text style={[styles.summary, {color: tokens.textSecondary}]}>
          {detail}
        </Text>
      ) : null}
      {canOpen ? (
        <Text style={[styles.openHint, {color: tokens.primary}]}>
          点击查看 · 聊天工作区
        </Text>
      ) : null}
    </>
  );

  if (canOpen) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`打开文件 ${filePath}`}
        onPress={() => onOpenFile(filePath)}
        style={({pressed}) => [
          groupItem ? styles.groupItem : styles.card,
          {
            backgroundColor: tokens.surface,
            borderColor: canOpen ? tokens.primary : tokens.border,
            opacity: pressed ? 0.85 : 1,
          },
        ]}>
        {card}
      </Pressable>
    );
  }

  return (
    <View
      style={[
        groupItem ? styles.groupItem : styles.card,
        {backgroundColor: tokens.surface, borderColor: tokens.border},
      ]}>
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
  name: {flex: 1, fontWeight: '600', fontSize: 14},
  status: {fontSize: 12, fontWeight: '500'},
  summary: {marginTop: 6, fontSize: 13},
  openHint: {marginTop: 8, fontSize: 12, fontWeight: '500'},
});
