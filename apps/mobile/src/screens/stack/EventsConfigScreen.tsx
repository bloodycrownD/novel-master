/**
 * Events configuration: editable event blocks with nested actions (prompt-block UX).
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Alert, Pressable, StyleSheet, Text, View} from 'react-native';
import {DEFAULT_EVENTS_CONFIG, type EventsConfig} from '@novel-master/core';
import {EventBlockEditor} from '../../components/events/EventConfigBlocks';
import {
  ACTION_ADD_OPTIONS,
  EVENT_ADD_OPTIONS,
  configToEventBlocks,
  createDefaultAction,
  defaultDagForEvent,
  eventBlocksToConfig,
  isUnknownActionDraft,
  loadEventsConfigForEditor,
  newEventBlockId,
  validateEventConfigBlocks,
  type EventBlockDraft,
} from '@novel-master/core/config-forms/events';
import {FormSectionCard} from '../../components/form/FormSectionCard';
import {ScreenFormLayout} from '../../components/form/ScreenFormLayout';
import {StickyFormFooter} from '../../components/form/StickyFormFooter';
import {BottomSheetMenu} from '../../components/sheet/BottomSheetMenu';
import {useDismissOverlaysOnBlur} from '../../hooks/useDismissOverlaysOnBlur';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import {exportEventsYaml, importEventsYaml} from '../../services/events-yaml.service';

function collectUnknownWireKeys(blocks: readonly EventBlockDraft[]): string[] {
  const keys = new Set<string>();
  for (const block of blocks) {
    for (const action of block.actions) {
      if (isUnknownActionDraft(action)) {
        keys.add(action.wireKey);
      }
    }
  }
  return [...keys];
}

export function EventsConfigScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const runtime = useRuntime();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [schemaVersion, setSchemaVersion] = useState<2>(2);
  const [blocks, setBlocks] = useState<EventBlockDraft[]>([]);
  const [addEventVisible, setAddEventVisible] = useState(false);
  const [addActionEventId, setAddActionEventId] = useState<string | null>(null);

  const dismissAllOverlays = useCallback(() => {
    setAddEventVisible(false);
    setAddActionEventId(null);
  }, []);

  useDismissOverlaysOnBlur(dismissAllOverlays);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const wire = await runtime.eventsConfig.getRawWire();
      const loaded = loadEventsConfigForEditor(wire);
      setSchemaVersion(loaded.schemaVersion);
      setBlocks(loaded.blocks);
      setLoadError(null);
      if (loaded.unknownActions.length > 0) {
        showToastRef.current(
          `未知 action：${loaded.unknownActions.join('、')}，请移除后保存`,
        );
      }
    } catch (error) {
      const message = toastMessage('加载事件配置失败', error);
      setSchemaVersion(DEFAULT_EVENTS_CONFIG.schemaVersion);
      setBlocks(configToEventBlocks(DEFAULT_EVENTS_CONFIG));
      setLoadError(message);
      showToastRef.current(message);
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

  const removeAllUnknownActions = () => {
    setBlocks(prev =>
      prev.map(block => ({
        ...block,
        actions: block.actions.filter(action => !isUnknownActionDraft(action)),
      })),
    );
    showToast('已移除全部未知动作');
  };

  const unknownWireKeys = collectUnknownWireKeys(blocks);
  const hasUnknownActions = unknownWireKeys.length > 0;

  const handleSave = async () => {
    if (blocks.some(block => block.actions.length === 0)) {
      showToast('请为每个事件至少保留一个有效动作');
      return;
    }
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

  const handleRecoverRestoreAndSave = async () => {
    setRecovering(true);
    try {
      await runtime.eventsConfig.setConfig(DEFAULT_EVENTS_CONFIG);
      setSchemaVersion(DEFAULT_EVENTS_CONFIG.schemaVersion);
      setBlocks(configToEventBlocks(DEFAULT_EVENTS_CONFIG));
      setLoadError(null);
      showToast('已恢复默认并保存');
    } catch (error) {
      showToast(toastMessage('恢复默认并保存失败', error));
    } finally {
      setRecovering(false);
    }
  };

  const handleRecoverClearAndSave = async () => {
    setRecovering(true);
    try {
      await runtime.eventsConfig.clearConfig();
      await runtime.eventsConfig.setConfig(DEFAULT_EVENTS_CONFIG);
      setSchemaVersion(DEFAULT_EVENTS_CONFIG.schemaVersion);
      setBlocks(configToEventBlocks(DEFAULT_EVENTS_CONFIG));
      setLoadError(null);
      showToast('已清空旧配置并保存默认配置');
    } catch (error) {
      showToast(toastMessage('清空并保存失败', error));
    } finally {
      setRecovering(false);
    }
  };

  const handleExportYaml = useCallback(async () => {
    try {
      const result = await exportEventsYaml(runtime);
      if (result === 'saved') {
        showToast('已导出 Events YAML');
      }
    } catch (error) {
      showToast(toastMessage('导出 YAML 失败', error));
    }
  }, [runtime, showToast]);

  const handleImportYaml = useCallback(() => {
    Alert.alert('导入 YAML', '将覆盖当前事件配置，是否继续？', [
      {text: '取消', style: 'cancel'},
      {
        text: '导入',
        onPress: () => {
          void (async () => {
            try {
              await importEventsYaml(runtime);
              await load();
              showToast('已导入 Events YAML');
            } catch (error) {
              showToast(toastMessage('导入 YAML 失败', error));
            }
          })();
        },
      },
    ]);
  }, [runtime, load, showToast]);

  const usingDefault =
    JSON.stringify(eventBlocksToConfig(blocks, schemaVersion).events) ===
    JSON.stringify(DEFAULT_EVENTS_CONFIG.events);

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
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
            <View style={styles.rightActions}>
              <Pressable onPress={() => handleImportYaml()}>
                <Text style={{color: tokens.primary, fontWeight: '600'}}>
                  导入 YAML
                </Text>
              </Pressable>
              <Pressable onPress={() => handleExportYaml().catch(() => undefined)}>
                <Text style={{color: tokens.primary, fontWeight: '600'}}>
                  导出 YAML
                </Text>
              </Pressable>
              <Pressable onPress={() => setAddEventVisible(true)}>
                <Text style={{color: tokens.primary, fontWeight: '600'}}>
                  添加
                </Text>
              </Pressable>
            </View>
          }>
          {loadError != null ? (
            <View
              style={[
                styles.recoveryCard,
                {borderColor: tokens.border, backgroundColor: tokens.surface},
              ]}>
              <Text style={[styles.recoveryTitle, {color: tokens.text}]}>
                检测到旧版/无效事件配置，已无法按 DAG 规则解析
              </Text>
              <Text style={[styles.recoveryText, {color: tokens.textSecondary}]}>
                {loadError}
              </Text>
              <View style={styles.recoveryActions}>
                <Pressable disabled={recovering || saving} onPress={() => handleRecoverRestoreAndSave()}>
                  <Text style={{color: tokens.primary, fontSize: 13, fontWeight: '600'}}>
                    恢复默认并保存
                  </Text>
                </Pressable>
                <Pressable disabled={recovering || saving} onPress={() => handleRecoverClearAndSave()}>
                  <Text style={{color: tokens.primary, fontSize: 13, fontWeight: '600'}}>
                    清空旧配置并保存
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {hasUnknownActions ? (
            <View
              style={[
                styles.unknownBanner,
                {
                  borderColor: tokens.danger,
                  backgroundColor: `${tokens.danger}14`,
                },
              ]}>
              <Text style={[styles.unknownBannerTitle, {color: tokens.text}]}>
                配置含已废弃动作
              </Text>
              <Text style={[styles.unknownBannerText, {color: tokens.textSecondary}]}>
                {unknownWireKeys.join('、')} 等，请删除后保存
              </Text>
              <View style={styles.unknownBannerActions}>
                <Pressable disabled={saving || recovering} onPress={removeAllUnknownActions}>
                  <Text style={{color: tokens.primary, fontSize: 13, fontWeight: '600'}}>
                    移除全部未知动作
                  </Text>
                </Pressable>
                <Pressable
                  disabled={saving || recovering}
                  onPress={() => handleRecoverRestoreAndSave()}>
                  <Text style={{color: tokens.primary, fontSize: 13, fontWeight: '600'}}>
                    恢复默认并保存
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
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

      {loading ? (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rightActions: {flexDirection: 'row', alignItems: 'center', gap: 12},
  status: {flex: 1, fontSize: 13, lineHeight: 18},
  blockList: {gap: 12, marginHorizontal: 5},
  empty: {textAlign: 'center', padding: 24, fontSize: 14},
  recoveryCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    marginBottom: 12,
  },
  recoveryTitle: {fontSize: 13, fontWeight: '600', lineHeight: 18},
  recoveryText: {fontSize: 12, lineHeight: 17},
  recoveryActions: {flexDirection: 'row', alignItems: 'center', gap: 16},
  unknownBanner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    marginBottom: 12,
  },
  unknownBannerTitle: {fontSize: 13, fontWeight: '600', lineHeight: 18},
  unknownBannerText: {fontSize: 12, lineHeight: 17},
  unknownBannerActions: {flexDirection: 'row', alignItems: 'center', gap: 16},
});
