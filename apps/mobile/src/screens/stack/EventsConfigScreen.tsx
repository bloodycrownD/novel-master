/**
 * Events configuration: editable event blocks with nested actions (prompt-block UX).
 */
import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import {DEFAULT_EVENTS_CONFIG, type EventsConfig} from '@novel-master/core';
import {EventBlockEditor} from '../../components/events/EventConfigBlocks';
import {
  ACTION_ADD_OPTIONS,
  EVENT_ADD_OPTIONS,
  createDefaultAction,
  defaultDagForEvent,
} from '../../components/events/event-config-labels';
import {
  configToEventBlocks,
  eventBlocksToConfig,
  newEventBlockId,
  type EventBlockDraft,
} from '../../components/events/event-config-state';
import {validateEventConfigBlocks} from '../../components/events/validate-event-config-blocks';
import {FormSectionCard} from '../../components/form/FormSectionCard';
import {ScreenFormLayout} from '../../components/form/ScreenFormLayout';
import {StickyFormFooter} from '../../components/form/StickyFormFooter';
import {BottomSheetMenu} from '../../components/sheet/BottomSheetMenu';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';

export function EventsConfigScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schemaVersion, setSchemaVersion] = useState<2>(2);
  const [blocks, setBlocks] = useState<EventBlockDraft[]>([]);
  const [addEventVisible, setAddEventVisible] = useState(false);
  const [addActionEventId, setAddActionEventId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await runtime.eventsConfig.getConfig();
      setSchemaVersion(loaded.schemaVersion);
      setBlocks(configToEventBlocks(loaded));
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const updateBlock = (id: string, patch: Partial<EventBlockDraft>) => {
    setBlocks(prev =>
      prev.map(b => (b.id === id ? {...b, ...patch} : b)),
    );
  };

  const deleteBlock = (id: string) => {
    if (blocks.length <= 1) {
      showToast('至少保留一个事件，无法删除');
      return;
    }
    setBlocks(prev => prev.filter(b => b.id !== id));
    showToast('已移除事件');
  };

  const moveBlock = (id: string, dir: -1 | 1) => {
    setBlocks(prev => {
      const index = prev.findIndex(b => b.id === id);
      if (index < 0) {
        return prev;
      }
      const target = index + dir;
      if (target < 0 || target >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const tmp = next[target]!;
      next[target] = next[index]!;
      next[index] = tmp;
      return next;
    });
  };

  const addEvent = (eventType: string) => {
    const trimmed = eventType.trim();
    setBlocks(prev => [
      ...prev,
      {
        id: newEventBlockId(),
        eventType: trimmed,
        actions: [...defaultDagForEvent(trimmed)],
      },
    ]);
  };

  const addAction = (eventId: string, type: (typeof ACTION_ADD_OPTIONS)[number]['type']) => {
    setBlocks(prev =>
      prev.map(b => {
        if (b.id !== eventId) {
          return b;
        }
        return {
          ...b,
          actions: [...b.actions, createDefaultAction(type)],
        };
      }),
    );
    setAddActionEventId(null);
  };

  const handleSave = async () => {
    const err = validateEventConfigBlocks(blocks);
    if (err != null) {
      showToast(err);
      return;
    }
    const config: EventsConfig = eventBlocksToConfig(blocks, schemaVersion);
    setSaving(true);
    try {
      await runtime.eventsConfig.setConfig(config);
      showToast('已保存事件配置');
    } catch (error) {
      showToast(toastMessage('保存失败', error));
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreDefault = () => {
    setSchemaVersion(DEFAULT_EVENTS_CONFIG.schemaVersion);
    setBlocks(configToEventBlocks(DEFAULT_EVENTS_CONFIG));
    showToast('已恢复默认（需点保存）');
  };

  const usingDefault =
    JSON.stringify(eventBlocksToConfig(blocks, schemaVersion).events) ===
    JSON.stringify(DEFAULT_EVENTS_CONFIG.events);

  if (loading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  return (
    <>
      <ScreenFormLayout
        tokens={tokens}
        scrollEnabled={!addEventVisible && addActionEventId == null}
        footer={
          addEventVisible || addActionEventId != null ? null : (
            <StickyFormFooter
              tokens={tokens}
              label="保存"
              loading={saving}
              onPress={() => handleSave().catch(() => undefined)}
            />
          )
        }>
        <FormSectionCard
          title="事件"
          tokens={tokens}
          hint="定义「发生什么事后执行哪些动作」。自动压缩的触发条件请在「压缩条件」里设置。重复的事件或动作在保存时会提示；有 2 个及以上事件时，点卡片右上角 × 可移除。"
          rightAction={
            <Pressable onPress={() => setAddEventVisible(true)}>
              <Text style={{color: tokens.primary, fontWeight: '600'}}>
                添加
              </Text>
            </Pressable>
          }>
          <View style={styles.toolbar}>
            <Text style={[styles.status, {color: tokens.textSecondary}]}>
              {usingDefault ? '当前为默认配置。' : '已修改，保存后生效。'}
            </Text>
            <Pressable onPress={handleRestoreDefault}>
              <Text style={{color: tokens.primary, fontSize: 14}}>恢复默认</Text>
            </Pressable>
          </View>
        </FormSectionCard>

        <View style={styles.blockList}>
          {blocks.map((block, index) => (
            <EventBlockEditor
              key={block.id}
              tokens={tokens}
              block={block}
              index={index}
              total={blocks.length}
              onChange={patch => updateBlock(block.id, patch)}
              onDelete={() => deleteBlock(block.id)}
              onMove={dir => moveBlock(block.id, dir)}
              onAddAction={() => setAddActionEventId(block.id)}
              onMinActions={() => showToast('至少保留一个动作')}
            />
          ))}
        </View>

        {blocks.length === 0 ? (
          <Text style={[styles.empty, {color: tokens.textSecondary}]}>
            点击「添加」创建第一个事件。
          </Text>
        ) : null}
      </ScreenFormLayout>

      <BottomSheetMenu
        visible={addEventVisible}
        title="添加事件"
        items={EVENT_ADD_OPTIONS.map(o => ({
          label: o.label,
          action: o.eventType,
        }))}
        onClose={() => setAddEventVisible(false)}
        onSelect={addEvent}
      />

      <BottomSheetMenu
        visible={addActionEventId != null}
        title="添加动作"
        items={ACTION_ADD_OPTIONS.map(o => ({
          label: o.label,
          action: o.type,
        }))}
        onClose={() => setAddActionEventId(null)}
        onSelect={action => {
          if (addActionEventId != null) {
            addAction(addActionEventId, action as (typeof ACTION_ADD_OPTIONS)[number]['type']);
          }
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loader: {marginTop: 32},
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  status: {flex: 1, fontSize: 13, lineHeight: 18},
  blockList: {gap: 12},
  empty: {textAlign: 'center', padding: 24, fontSize: 14},
});
