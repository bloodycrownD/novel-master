/**
 * Session log timeline list (tools + checkpoints).
 */
import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';
import {
  formatRelativeTimeMs,
  type TimelineCheckpointItem,
  type TimelineItem,
  type TimelineToolItem,
} from './timeline-builder';

type Props = {
  items: readonly TimelineItem[];
  nowMs: number;
  rollbackInProgress: boolean;
  onRollback: (batchId: string) => void;
  emptyLabel?: string;
};

export function SessionTimeline({
  items,
  nowMs,
  rollbackInProgress,
  onRollback,
  emptyLabel = '暂无会话日志',
}: Props) {
  const {tokens} = useTheme();

  return (
    <FlatList
      data={items as TimelineItem[]}
      keyExtractor={item =>
        item.kind === 'tool' ? item.id : `cp-${item.batchId}`
      }
      contentContainerStyle={
        items.length === 0 ? styles.emptyContainer : styles.list
      }
      ListEmptyComponent={
        <Text style={[styles.empty, {color: tokens.textSecondary}]}>
          {emptyLabel}
        </Text>
      }
      renderItem={({item}) =>
        item.kind === 'tool' ? (
          <ToolRow item={item} nowMs={nowMs} tokens={tokens} />
        ) : (
          <CheckpointRow
            item={item}
            nowMs={nowMs}
            tokens={tokens}
            rollbackInProgress={rollbackInProgress}
            onRollback={onRollback}
          />
        )
      }
    />
  );
}

function ToolRow({
  item,
  nowMs,
  tokens,
}: {
  item: TimelineToolItem;
  nowMs: number;
  tokens: ReturnType<typeof useTheme>['tokens'];
}) {
  const borderColor =
    item.status === 'error'
      ? tokens.danger
      : item.status === 'pending'
        ? tokens.textTertiary
        : tokens.success;

  return (
    <View
      style={[
        styles.item,
        styles.toolItem,
        {
          backgroundColor: tokens.surface,
          borderLeftColor: borderColor,
          opacity: item.expired ? 0.65 : 1,
        },
      ]}>
      <Text style={[styles.kind, {color: tokens.textSecondary}]}>工具</Text>
      <View style={styles.row}>
        <Text style={[styles.title, {color: tokens.text}]}>{item.name}</Text>
        <Text style={[styles.time, {color: tokens.textSecondary}]}>
          {formatRelativeTimeMs(nowMs, item.createdAtMs)}
        </Text>
      </View>
      <Text style={[styles.summary, {color: tokens.text}]}>{item.summary}</Text>
      {item.linkedBatchId ? (
        <Text style={[styles.meta, {color: tokens.textSecondary}]}>
          检查点:{' '}
          {item.expired ? (
            <Text style={{color: tokens.textTertiary}}>
              {item.linkedBatchId.slice(0, 12)}（已移除）
            </Text>
          ) : (
            item.linkedBatchId.slice(0, 12)
          )}
        </Text>
      ) : null}
    </View>
  );
}

function CheckpointRow({
  item,
  nowMs,
  tokens,
  rollbackInProgress,
  onRollback,
}: {
  item: TimelineCheckpointItem;
  nowMs: number;
  tokens: ReturnType<typeof useTheme>['tokens'];
  rollbackInProgress: boolean;
  onRollback: (batchId: string) => void;
}) {
  const canRollback = !item.expired && !rollbackInProgress;

  return (
    <View
      style={[
        styles.item,
        styles.checkpointItem,
        {
          backgroundColor: tokens.surfaceElevated,
          borderColor: tokens.border,
          opacity: item.expired ? 0.65 : 1,
        },
      ]}>
      <Text style={[styles.kind, {color: tokens.textSecondary}]}>检查点</Text>
      <View style={styles.row}>
        <Text style={[styles.title, {color: tokens.text}]}>
          {item.batchId.slice(0, 16)}
        </Text>
        <Text style={[styles.time, {color: tokens.textSecondary}]}>
          {formatRelativeTimeMs(nowMs, item.createdAtMs)}
        </Text>
      </View>
      <Text style={[styles.meta, {color: tokens.textSecondary}]}>
        {item.sourceLabel}
      </Text>
      <Text style={[styles.summary, {color: tokens.text}]}>{item.pathSummary}</Text>
      <Pressable
        style={[
          styles.rollbackBtn,
          {
            borderColor: tokens.border,
            backgroundColor: tokens.surface,
          },
        ]}
        disabled={!canRollback}
        onPress={() => onRollback(item.batchId)}>
        {rollbackInProgress ? (
          <ActivityIndicator size="small" color={tokens.primary} />
        ) : (
          <Text
            style={{
              color: canRollback ? tokens.text : tokens.textTertiary,
            }}>
            {item.expired ? '检查点已移除' : '回滚到此'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {paddingBottom: 24},
  emptyContainer: {flexGrow: 1, justifyContent: 'center'},
  empty: {textAlign: 'center', padding: 32},
  item: {
    marginHorizontal: 12,
    marginTop: 10,
    padding: 12,
    borderRadius: 8,
  },
  toolItem: {borderLeftWidth: 3},
  checkpointItem: {borderWidth: StyleSheet.hairlineWidth},
  kind: {fontSize: 11, fontWeight: '600', marginBottom: 6},
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  title: {fontSize: 15, fontWeight: '600', flex: 1},
  time: {fontSize: 12},
  summary: {fontSize: 13, marginTop: 6},
  meta: {fontSize: 12, marginTop: 4},
  rollbackBtn: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
});
