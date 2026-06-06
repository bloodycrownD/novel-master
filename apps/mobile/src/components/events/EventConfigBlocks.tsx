/**
 * Prompt-block-style editors for events and nested actions.
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {EventActionNode, EventActionType} from '@novel-master/core';
import {FormField} from '../form/FormField';
import {FormTextInput} from '../form/FormTextInput';
import {useDismissOverlaysOnBlur} from '../../hooks/useDismissOverlaysOnBlur';
import type {ThemeTokens} from '../../theme/tokens';
import {parseOptionalDepthInput} from '../../services/regex-test.service';
import type {EventBlockDraft} from '@novel-master/config-forms/events';
import {BottomSheetMenu} from '../sheet/BottomSheetMenu';
import {
  actionTypeHint,
  actionTypeLabel,
  eventTypeHint,
  eventTypeLabel,
} from '@novel-master/config-forms/events';

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
  availableDependencies,
}: {
  action: EventActionNode;
  index: number;
  total: number;
  tokens: ThemeTokens;
  onChange: (action: EventActionNode) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  availableDependencies: readonly EventActionType[];
}) {
  const badgeColor =
    action.type === 'hide-message' ? tokens.primary : tokens.success;
  const currentDeps = action.dependency ?? [];
  const selectableDeps = availableDependencies.filter(
    type => !currentDeps.includes(type),
  );
  const [depPickerOpen, setDepPickerOpen] = React.useState(false);

  const dismissAllOverlays = React.useCallback(() => {
    setDepPickerOpen(false);
  }, []);

  useDismissOverlaysOnBlur(dismissAllOverlays);

  const setDeps = (deps: readonly EventActionType[]) => {
    onChange({
      ...action,
      dependency: deps.length > 0 ? deps : undefined,
    });
  };

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
      <View style={styles.actionFields}>
        <FormField
          label="依赖（DAG）"
          tokens={tokens}
          hint="从下拉列表选择依赖动作；留空表示无依赖（可并发执行）">
          <Pressable
            style={[
              styles.depInputBox,
              {backgroundColor: tokens.bgSecondary, borderColor: tokens.borderLight},
            ]}
            onPress={() => setDepPickerOpen(true)}>
            {currentDeps.length === 0 ? (
              <Text style={{color: tokens.textSecondary}}>选择依赖动作</Text>
            ) : (
              <View style={styles.depChips}>
                {currentDeps.map(dep => (
                  <Pressable
                    key={dep}
                    style={[
                      styles.depChip,
                      {
                        borderColor: tokens.borderLight,
                        backgroundColor: tokens.surface,
                      },
                    ]}
                    onPress={e => {
                      e.stopPropagation();
                      setDeps(currentDeps.filter(item => item !== dep));
                    }}>
                    <Text style={{color: tokens.text}}>{actionTypeLabel(dep)}</Text>
                    <Text style={{color: tokens.textSecondary}}>×</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <Text style={{color: tokens.textSecondary}}>▼</Text>
          </Pressable>
          <BottomSheetMenu
            visible={depPickerOpen}
            title="依赖动作"
            items={[
              ...selectableDeps.map(type => ({
                label: actionTypeLabel(type),
                action: type,
              })),
              ...(currentDeps.length > 0
                ? [{label: '清空依赖', action: '__clear__', danger: true}]
                : []),
            ]}
            onClose={() => setDepPickerOpen(false)}
            onSelect={selected => {
              if (selected === '__clear__') {
                setDeps([]);
                return;
              }
              setDeps([...currentDeps, selected as EventActionType]);
            }}
          />
        </FormField>
      </View>
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
                  ...action,
                  params: {
                    ...action.params,
                    startDepth: parseOptionalDepthInput(v) ?? undefined,
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
                  ...action,
                  params: {...action.params, endDepth: parseOptionalDepthInput(v) ?? undefined},
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
                  ...action,
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
  const displayType = block.eventType.trim();

  const updateAction = (actionIndex: number, action: EventActionNode) => {
    const actions = block.actions.map((a, i) => (i === actionIndex ? action : a));
    onChange({actions});
  };

  const deleteAction = (actionIndex: number) => {
    if (block.actions.length <= 1) {
      return false;
    }
    onChange({actions: block.actions.filter((_, i) => i !== actionIndex)});
    return true;
  };

  const moveAction = (actionIndex: number, dir: -1 | 1) => {
    const target = actionIndex + dir;
    if (target < 0 || target >= block.actions.length) {
      return;
    }
    const actions = [...block.actions];
    const tmp = actions[target]!;
    actions[target] = actions[actionIndex]!;
    actions[actionIndex] = tmp;
    onChange({actions});
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
      <Text style={[styles.fieldHint, {color: tokens.textSecondary}]}>
        DAG：无依赖动作会并发执行；下游需等待所有依赖成功。任一失败将终止后续调度。
      </Text>

      <View style={styles.actionsHeader}>
        <Text style={[styles.actionsTitle, {color: tokens.text}]}>动作</Text>
        <Pressable onPress={onAddAction}>
          <Text style={{color: tokens.primary, fontWeight: '600'}}>添加</Text>
        </Pressable>
      </View>

      <View style={styles.blockList}>
        {block.actions.map((action, actionIndex) => {
          const availableDependencies = [
            ...new Set(
              block.actions
                .map(a => a.type)
                .filter(type => type !== action.type),
            ),
          ] as EventActionType[];
          return (
            <ActionBlockCard
              key={`${block.id}-action-${actionIndex}`}
              action={action}
              index={actionIndex}
              total={block.actions.length}
              tokens={tokens}
              availableDependencies={availableDependencies}
              onChange={a => updateAction(actionIndex, a)}
              onDelete={() => {
                if (!deleteAction(actionIndex)) {
                  onMinActions();
                }
              }}
              onMove={dir => moveAction(actionIndex, dir)}
            />
          );
        })}
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
  depChips: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  depInputBox: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  depChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  warn: {fontSize: 12, lineHeight: 17},
});
