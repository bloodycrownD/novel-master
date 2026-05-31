/**
 * Tool invocation card with status from paired tool_result.
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';
import {toolCallSummary, type ToolCallView} from './message-blocks';

type Props = {
  tool: ToolCallView;
  showFullParams?: boolean;
};

function statusLabel(status: ToolCallView['status']): string {
  switch (status) {
    case 'success':
      return '成功';
    case 'error':
      return '失败';
    default:
      return '进行中';
  }
}

function statusColor(
  status: ToolCallView['status'],
  tokens: {primary: string; danger: string; textSecondary: string},
): string {
  switch (status) {
    case 'success':
      return tokens.primary;
    case 'error':
      return tokens.danger;
    default:
      return tokens.textSecondary;
  }
}

export function ToolCallCard({tool, showFullParams}: Props) {
  const {tokens} = useTheme();
  const summary = toolCallSummary(tool);
  const detail = showFullParams
    ? JSON.stringify(tool.input, null, 2)
    : summary;

  return (
    <View
      style={[
        styles.card,
        {backgroundColor: tokens.surface, borderColor: tokens.border},
      ]}>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  name: {flex: 1, fontWeight: '600', fontSize: 14},
  status: {fontSize: 12, fontWeight: '500'},
  summary: {marginTop: 6, fontSize: 13},
});
