/**
 * Prompt-block-style editors for events and nested actions.
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {EventAction, EventExecutionMode} from '@novel-master/core';
import {FormField} from '../form/FormField';
import {FormTextInput} from '../form/FormTextInput';
import {SegmentedControl} from '../ui/SegmentedControl';
import type {ThemeTokens} from '../../theme/tokens';
import {parseOptionalDepthInput} from '../../services/regex-test.service';
import type {EventBlockDraft} from './event-config-state';
import {
  actionTypeHint,
  actionTypeLabel,
  eventTypeHint,
  eventTypeLabel,
} from './event-config-labels';

const MODE_OPTIONS = [
  {value: 'parallel' as const, label: '并行'},
  {value: 'sequential' as const, label: '顺序'},
];

function BlockIconButton({
  label,
  tokens,
  onPress,
  danger,
}: {
  label: string;
  tokens: ThemeTokens;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      style={[
        styles.iconBtn,
        {borderColor: tokens.border, backgroundColor: tokens.surface},
      ]}
      onPress={onPress}
      accessibilityLabel={label}>
      <Text style={{color: danger ? tokens.danger : tokens.textSecondary}}>
        {label}
      </Text>
    </Pressable>
  );
}

function ActionBlockCard({
  action,
  index,
  total,
  tokens,
  onChange,
  onDelete,
  onMove,
}: {
  action: EventAction;
  index: number;
  total: number;
  tokens: ThemeTokens;
  onChange: (action: EventAction) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const badgeColor =
    action.type === 'hide-message' ? tokens.primary : tokens.success;

  return (
    <View
      style={[
        styles.blockCard,
        {backgroundColor: tokens.surface, borderColor: tokens.border},
      ]}>
      <View style={styles.blockHeader}>
        <View style={[styles.typeBadge, {backgroundColor: `${badgeColor}1A`}]}>
          <Text style={[styles.typeBadgeText, {color: badgeColor}]}>
            {actionTypeLabel(action.type)}
          </Text>
        </View>
        <Text style={[styles.blockIndex, {color: tokens.textSecondary}]}>
          动作 {index + 1}
        </Text>
        <View style={styles.blockActions}>
          {index > 0 ? (
            <BlockIconButton label="↑" tokens={tokens} onPress={() => onMove(-1)} />
          ) : null}
          {index < total - 1 ? (
            <BlockIconButton label="↓" tokens={tokens} onPress={() => onMove(1)} />
          ) : null}
          <BlockIconButton
            label="×"
            tokens={tokens}
            danger
            onPress={onDelete}
          />
        </View>
      </View>
      <Text style={[styles.fieldHint, {color: tokens.textSecondary}]}>
        {actionTypeHint(action.type)}
      </Text>
      {action.type === 'hide-message' ? (
        <View style={styles.actionFields}>
          <FormField label="起始深度" tokens={tokens} hint="0 = 最新一条；留空表示不限制">
            <FormTextInput
              tokens={tokens}
              value={
                action.params.startDepth != null
                  ? String(action.params.startDepth)
                  : ''
              }
              onChangeText={v =>
                onChange({
                  type: 'hide-message',
                  params: {
                    ...action.params,
                    startDepth: parseOptionalDepthInput(v),
                  },
                })
              }
              placeholder="如 6"
              keyboardType="number-pad"
            />
          </FormField>
          <FormField label="结束深度" tokens={tokens} hint="留空表示不限制">
            <FormTextInput
              tokens={tokens}
              value={
                action.params.endDepth != null ? String(action.params.endDepth) : ''
              }
              onChangeText={v =>
                onChange({
                  type: 'hide-message',
                  params: {
                    ...action.params,
                    endDepth: parseOptionalDepthInput(v),
                  },
                })
              }
              placeholder="留空"
              keyboardType="number-pad"
            />
          </FormField>
        </View>
      ) : null}
      {action.type === 'run-agent' ? (
        <View style={styles.actionFields}>
          <FormField label="Agent ID" tokens={tokens} hint="注册表中的 Agent 标识">
            <FormTextInput
              tokens={tokens}
              value={
                'agentId' in action.params ? String(action.params.agentId) : ''
              }
              onChangeText={v =>
                onChange({
                  type: 'run-agent',
                  params: {agentId: v.trim()},
                })
              }
              placeholder="例如 compaction-agent"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </FormField>
        </View>
      ) : null}
    </View>
  );
}

export type EventBlockEditorProps = {
  tokens: ThemeTokens;
  block: EventBlockDraft;
  index: number;
  total: number;
  onChange: (patch: Partial<EventBlockDraft>) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onAddAction: () => void;
  onMinActions: () => void;
};

/** One event block with nested action blocks (like one prompt section). */
export function EventBlockEditor({
  tokens,
  block,
  index,
  total,
  onChange,
  onDelete,
  onMove,
  onAddAction,
  onMinActions,
}: EventBlockEditorProps) {
  const chain = block.chain;
  const displayType = block.eventType.trim();

  const setChain = (next: EventExecutionMode) => {
    onChange({chain: next});
  };

  const updateAction = (actionIndex: number, action: EventAction) => {
    const actions = chain.actions.map((a, i) => (i === actionIndex ? action : a));
    setChain({...chain, actions});
  };

  const deleteAction = (actionIndex: number) => {
    if (chain.actions.length <= 1) {
      return false;
    }
    setChain({
      ...chain,
      actions: chain.actions.filter((_, i) => i !== actionIndex),
    });
    return true;
  };

  const moveAction = (actionIndex: number, dir: -1 | 1) => {
    const target = actionIndex + dir;
    if (target < 0 || target >= chain.actions.length) {
      return;
    }
    const actions = [...chain.actions];
    const tmp = actions[target]!;
    actions[target] = actions[actionIndex]!;
    actions[actionIndex] = tmp;
    setChain({...chain, actions});
  };

  return (
    <View
      style={[
        styles.eventCard,
        {
          backgroundColor: tokens.surfaceElevated,
          borderColor: tokens.borderLight,
        },
      ]}>
      <View style={styles.blockHeader}>
        <View style={[styles.typeBadge, {backgroundColor: `${tokens.primary}22`}]}>
          <Text style={[styles.typeBadgeText, {color: tokens.primary}]}>事件</Text>
        </View>
        <Text style={[styles.eventOrdinal, {color: tokens.textSecondary}]}>
          {index + 1} / {total}
        </Text>
        <View style={styles.blockActions}>
          {index > 0 ? (
            <BlockIconButton label="↑" tokens={tokens} onPress={() => onMove(-1)} />
          ) : null}
          {index < total - 1 ? (
            <BlockIconButton label="↓" tokens={tokens} onPress={() => onMove(1)} />
          ) : null}
          <BlockIconButton label="×" tokens={tokens} danger onPress={onDelete} />
        </View>
      </View>

      <FormField label="事件" tokens={tokens}>
        <Text style={[styles.displayName, {color: tokens.text}]}>
          {eventTypeLabel(displayType)}
        </Text>
      </FormField>
      <Text style={[styles.fieldHint, {color: tokens.textSecondary}]}>
        {eventTypeHint(displayType)}
      </Text>

      <FormField label="执行方式" tokens={tokens}>
        <SegmentedControl
          tokens={tokens}
          options={MODE_OPTIONS}
          value={chain.mode}
          onChange={mode => setChain({...chain, mode})}
        />
      </FormField>
      <Text style={[styles.fieldHint, {color: tokens.textSecondary}]}>
        {chain.mode === 'parallel'
          ? '多个动作同时执行；某个失败不会撤销已成功的步骤。'
          : '按顺序执行；某步失败则停止后续动作。'}
      </Text>

      <View style={styles.actionsHeader}>
        <Text style={[styles.actionsTitle, {color: tokens.text}]}>动作</Text>
        <Pressable onPress={onAddAction}>
          <Text style={{color: tokens.primary, fontWeight: '600'}}>添加</Text>
        </Pressable>
      </View>

      <View style={styles.blockList}>
        {chain.actions.map((action, actionIndex) => (
          <ActionBlockCard
            key={`${block.id}-action-${actionIndex}`}
            action={action}
            index={actionIndex}
            total={chain.actions.length}
            tokens={tokens}
            onChange={a => updateAction(actionIndex, a)}
            onDelete={() => {
              if (!deleteAction(actionIndex)) {
                onMinActions();
              }
            }}
            onMove={dir => moveAction(actionIndex, dir)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  eventCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eventOrdinal: {flex: 1, fontSize: 13},
  displayName: {fontSize: 15, fontWeight: '600'},
  actionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  actionsTitle: {fontSize: 14, fontWeight: '600'},
  blockList: {gap: 10},
  blockCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  blockIndex: {flex: 1, fontSize: 13},
  typeBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  typeBadgeText: {fontSize: 11, fontWeight: '600'},
  blockActions: {flexDirection: 'row', gap: 4},
  iconBtn: {
    width: 28,
    height: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldHint: {fontSize: 12, lineHeight: 17},
  actionFields: {gap: 4},
  warn: {fontSize: 12, lineHeight: 17},
});
