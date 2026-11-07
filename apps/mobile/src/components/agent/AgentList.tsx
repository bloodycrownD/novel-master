/**
 * Agent registry list with context menu (rename, duplicate, delete).
 * 双 tab（主智能体 / 子智能体）：过滤口径统一走 core 的 agentModeMatchesTab；
 * 内置 general 子智能体在子 tab 以只读合成行展示（不可勾选、不可增删）。
 */
import React, {useCallback, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {DEFAULT_SUBAGENT_DEFINITION} from '@novel-master/core/agent';
import type {AgentDefinition} from '@novel-master/core/agent';
import {agentModeMatchesTab, type AgentSettingsTab} from '@/config-forms/agent';
import * as storedConfig from '@novel-master/core/stored-config-validity';
import {BatchCheckbox} from '../batch/BatchCheckbox';
import {ManageHeader} from '../batch/ManageHeader';
import {BottomSheetMenu} from '../sheet/BottomSheetMenu';
import {SegmentedControl} from '../ui/SegmentedControl';
import {ElevatedCard} from '../ui/ElevatedCard';
import {PrimaryButton} from '../ui/Buttons';
import {TextPromptModal} from '../ui/TextPromptModal';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {useDismissOverlaysOnBlur} from '../../hooks/useDismissOverlaysOnBlur';
import {useRuntime} from '../../hooks/useRuntime';
import {resolveModelDisplayLabel} from '../../services/model-display-label';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import {pickEntityIcon} from '../../utils/entity-icon';
import {agentDisplayNameFromWire} from './agent-editor/useAgentEditorFormState';
import {coreT} from '@/i18n/core';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface AgentRow {
  id: string;
  name: string;
  def?: AgentDefinition;
  configInvalid?: boolean;
  /** 内置 general 合成行：只读展示，不参与批量勾选与增删改。 */
  builtin?: boolean;
  meta: string;
}

const AGENT_ICONS = ['🤖', '⚡', '📝', '🎯', '✨', '🚀'];

/**
 * 子 tab 头部合成的内置 general 行：运行时虚拟注入（registry 中无实体），
 * 点击进入只读详情（AgentEditor 的 general sentinel 分支）。
 */
const GENERAL_ROW: AgentRow = {
  id: 'general',
  name: DEFAULT_SUBAGENT_DEFINITION.name,
  def: DEFAULT_SUBAGENT_DEFINITION,
  builtin: true,
  // 双端文案对齐：desktop SettingsViews 合成行同款短文案；
  // 完整 description 留给编辑器详情页（initialDefinition）展示。
  meta: '通用助手 · 不可编辑',
};

const TAB_HINTS: Record<AgentSettingsTab, string> = {
  primary:
    '主智能体可直接选用作为对话主体；标注「全部」的智能体在两个 tab 均可用。',
  subagent:
    '子智能体由主智能体通过任务委派调用；标注「全部」的智能体在两个 tab 均可用。',
};

const EMPTY_TEXTS: Record<AgentSettingsTab, string> = {
  primary: '暂无主智能体，点击「新建」创建。',
  subagent: '暂无子智能体，点击「新建」创建。',
};

function agentMeta(d: AgentDefinition, label: string, ws: boolean): string {
  const steps = d.runtime?.maxSteps ?? 20;
  const modelPart = ws ? `${label} · 工作区` : label;
  return `${modelPart} · ${coreT(storedConfig.AGENT_LIST_LABELS.maxSteps(steps))}`;
}

type Props = {
  /** 新建回调：携带当前 tab（Screen 层据此决定新定义的默认作用域）。 */
  onCreate?: (tab: AgentSettingsTab) => void;
};

export function AgentList({onCreate}: Props) {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const [tab, setTab] = useState<AgentSettingsTab>('primary');
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuAgentId, setMenuAgentId] = useState<string | undefined>();
  const [renamePrompt, setRenamePrompt] = useState<
    {agentId: string; initialName: string} | undefined
  >();
  const batch = useBatchSelection();

  // nm-style: keep-local — React hook：多行回调 + deps 无法单行（prettier@80 必折行）
  const dismissAllOverlays = useCallback(() => {
    setMenuAgentId(undefined);
    setRenamePrompt(undefined);
  }, []);

  useDismissOverlaysOnBlur(dismissAllOverlays);

  // nm-style: keep-local — 列表装载与工作区模型解析的状态链，内联回 useCallback 会让调用参数跨行
  const reloadAgentList = async () => {
    setLoading(true);
    try {
      const ids = await runtime.agentRegistry.listAgentIds();
      const workspaceModelId = await runtime.state.getCurrentModelId();
      let wsLabel = '—';
      if (workspaceModelId) {
        try {
          wsLabel = await resolveModelDisplayLabel(runtime, workspaceModelId);
        } catch {
          wsLabel = workspaceModelId;
        }
      }
      const enriched: AgentRow[] = [];
      for (const id of ids) {
        const raw = await runtime.agentRegistry.getRawWire(id);
        // 空值防御：getRawWire 只在「行已进 listIds、逐条读之前被并发删掉」的
        // 窗口里返回空；直接访问 raw.name 会崩（列表页白屏），跳过该行避免
        // 渲染半截行。注：内置 general 走 GENERAL_ROW 合成、不经本循环。
        if (raw == null) {
          continue;
        }
        const health = storedConfig.assessAgentDefinitionWire(raw);
        if (health.status === 'valid') {
          const def = health.value;
          let meta: string;
          if (def.model) {
            let label = def.model;
            try {
              label = await resolveModelDisplayLabel(runtime, def.model);
            } catch {
              /* 使用原始 model id */
            }
            meta = agentMeta(def, label, false);
          } else {
            meta = agentMeta(def, wsLabel, true);
          }
          enriched.push({
            id,
            name: def.name?.trim() || id,
            def,
            meta,
          });
        } else {
          enriched.push({
            id,
            name: agentDisplayNameFromWire(raw, id),
            configInvalid: true,
            meta: coreT(storedConfig.storedConfigInvalidReason(health.code)),
          });
        }
      }
      setRows(enriched);
    } finally {
      setLoading(false);
    }
  };
  const reload = useCallback(reloadAgentList, [runtime]);

  // nm-style: keep-local — React hook：多行回调 + deps 无法单行（prettier@80 必折行）
  useFocusEffect(
    useCallback(() => {
      reload().catch(err => showToast(toastMessage('加载智能体列表失败', err)));
    }, [reload, showToast]),
  );

  // 全量加载后前端过滤（不重载）；invalid 行读不到 mode，按 all 双边显示。
  // 子 tab 头部合成内置 general 行（GENERAL_ROW def.mode 为 subagent，
  // 天然只落在子侧）。
  // nm-style: keep-local — React hook：多行回调 + deps 无法单行（prettier@80 必折行）
  const visibleRows = useMemo(() => {
    const filtered = rows.filter(row =>
      agentModeMatchesTab(row.def?.mode, tab),
    );
    return tab === 'subagent' ? [GENERAL_ROW, ...filtered] : filtered;
  }, [rows, tab]);

  // nm-style: keep-local — 批量删除确认收口「勾选集快照 → 逐个删 → 退批选 → 刷新」，
  // 22 行生命周期内联进 ManageHeader 的 prop 会把共享的批选状态拆散。
  const confirmBatchDelete = () => {
    const ids = Array.from(batch.selectedIds);
    if (ids.length === 0) {
      return;
    }
    Alert.alert('删除 Agent', `确定删除选中的 ${ids.length} 个 Agent？`, [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          (async () => {
            for (const agentId of ids) {
              await runtime.agentRegistry.delete(agentId);
            }
            batch.exit();
            await reload();
          })().catch(err => showToast(toastMessage('删除失败', err)));
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <ManageHeader
        title="Agent"
        batchMode={batch.active}
        selectedCount={batch.selectedCount}
        onEnterBatch={batch.enter}
        onCancelBatch={batch.exit}
        onDelete={confirmBatchDelete}
        hint="选择要删除的 Agent"
        normalActions={
          onCreate ? (
            <PrimaryButton
              label="新建"
              tokens={tokens}
              onPress={() => onCreate(tab)}
            />
          ) : null
        }
      />
      {/* 切 tab 退出批量模式（照技能管理页先例，两侧勾选集不互通） */}
      <SegmentedControl
        options={[
          {
            value: 'primary',
            label: '主智能体',
            testID: 'agents-tab-primary',
          },
          {
            value: 'subagent',
            label: '子智能体',
            testID: 'agents-tab-subagent',
          },
        ]}
        value={tab}
        onChange={next => {
          setTab(next);
          batch.exit();
        }}
        tokens={tokens}
      />
      <Text style={[styles.tabHint, {color: tokens.textSecondary}]}>
        {TAB_HINTS[tab]}
      </Text>
      {loading && rows.length === 0 ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={visibleRows}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} />
          }
          ListEmptyComponent={
            <Text style={[styles.empty, {color: tokens.textSecondary}]}>
              {EMPTY_TEXTS[tab]}
            </Text>
          }
          renderItem={({item, index}) => (
            <ElevatedCard
              tokens={tokens}
              selected={!item.builtin && batch.isSelected(item.id)}
              onPress={() => {
                // 内置 general 行不可进入批量勾选：批量态下点击不响应。
                if (item.builtin) {
                  if (!batch.active) {
                    navigation.navigate('AgentEditor', {agentId: item.id});
                  }
                  return;
                }
                if (batch.active) {
                  batch.toggle(item.id);
                } else {
                  navigation.navigate('AgentEditor', {agentId: item.id});
                }
              }}
            >
              {batch.active && !item.builtin ? (
                <BatchCheckbox
                  checked={batch.isSelected(item.id)}
                  onToggle={() => batch.toggle(item.id)}
                />
              ) : (
                <View
                  style={[styles.avatar, {backgroundColor: tokens.bgSecondary}]}
                >
                  <Text style={styles.avatarIcon}>
                    {item.builtin ? '🤖' : pickEntityIcon(item.id, AGENT_ICONS)}
                  </Text>
                </View>
              )}
              <View style={styles.info}>
                <View style={styles.nameRow}>
                  <Text
                    style={[styles.name, {color: tokens.text}]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  {/* mode 归一后为 all（显式/缺省）挂「全部」徽标；invalid 行读不到 def 也按 all */}
                  {item.builtin ? (
                    <View
                      style={[
                        styles.tagBadge,
                        {backgroundColor: `${tokens.primary}1A`},
                      ]}
                    >
                      <Text
                        style={[styles.tagBadgeText, {color: tokens.primary}]}
                      >
                        内置
                      </Text>
                    </View>
                  ) : (item.def?.mode ?? 'all') === 'all' ? (
                    <View
                      style={[
                        styles.tagBadge,
                        {backgroundColor: `${tokens.textTertiary}1A`},
                      ]}
                    >
                      <Text
                        style={[
                          styles.tagBadgeText,
                          {color: tokens.textTertiary},
                        ]}
                      >
                        全部
                      </Text>
                    </View>
                  ) : null}
                </View>
                {item.configInvalid ? (
                  <View style={styles.metaRow}>
                    <View
                      style={[
                        styles.invalidBadge,
                        {backgroundColor: tokens.warningMuted},
                      ]}
                    >
                      <Text
                        style={[
                          styles.invalidBadgeText,
                          {color: tokens.warning},
                        ]}
                      >
                        {coreT(storedConfig.AGENT_LIST_LABELS.configInvalid)}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.meta,
                        {color: tokens.textSecondary, flex: 1},
                      ]}
                      numberOfLines={1}
                    >
                      {item.meta}
                    </Text>
                  </View>
                ) : (
                  <Text
                    style={[styles.meta, {color: tokens.textSecondary}]}
                    numberOfLines={2}
                  >
                    {item.meta}
                  </Text>
                )}
              </View>
              {!batch.active && !item.builtin ? (
                <>
                  <Pressable
                    hitSlop={8}
                    onPress={e => {
                      e.stopPropagation?.();
                      setMenuAgentId(item.id);
                    }}
                  >
                    <Text
                      style={[styles.menuDots, {color: tokens.textSecondary}]}
                    >
                      ⋮
                    </Text>
                  </Pressable>
                  <Text style={[styles.chevron, {color: tokens.textTertiary}]}>
                    ›
                  </Text>
                </>
              ) : null}
            </ElevatedCard>
          )}
        />
      )}
      {/* 失效配置行仅允许删除，避免 strict get() 在重命名/复制时失败 */}
      <BottomSheetMenu
        visible={menuAgentId != null}
        items={
          !menuAgentId
            ? []
            : rows.find(r => r.id === menuAgentId)?.configInvalid
            ? [{label: '删除', action: 'delete', danger: true}]
            : [
                {label: '重命名', action: 'rename'},
                {label: '复制', action: 'duplicate'},
                {label: '删除', action: 'delete', danger: true},
              ]
        }
        onClose={() => setMenuAgentId(undefined)}
        onSelect={action => {
          const id = menuAgentId;
          setMenuAgentId(undefined);
          if (!id) {
            return;
          }
          if (action === 'rename') {
            const row = rows.find(r => r.id === id);
            if (row) {
              setRenamePrompt({agentId: id, initialName: row.name});
            }
          } else if (action === 'duplicate') {
            void (async () => {
              const def = await runtime.agentRegistry.get(id);
              const copyId = `agent-${Date.now()}`;
              await runtime.agentRegistry.upsert(copyId, {
                ...def,
                name: `${def.name}-copy`,
              });
              await reload();
              navigation.navigate('AgentEditor', {agentId: copyId});
            })().catch(() => undefined);
          } else if (action === 'delete') {
            const displayName = rows.find(r => r.id === id)?.name ?? id;
            Alert.alert('删除 Agent', `删除 Agent「${displayName}」？`, [
              {text: '取消', style: 'cancel'},
              {
                text: '删除',
                style: 'destructive',
                onPress: () => {
                  void (async () => {
                    await runtime.agentRegistry.delete(id);
                    await reload();
                  })().catch(err => showToast(toastMessage('删除失败', err)));
                },
              },
            ]);
          }
        }}
      />
      <TextPromptModal
        visible={renamePrompt != null}
        title="重命名 Agent"
        label="显示名称"
        placeholder="Agent 名称"
        initialValue={renamePrompt?.initialName ?? ''}
        confirmLabel="保存"
        onClose={() => setRenamePrompt(undefined)}
        onConfirm={async values => {
          const prompt = renamePrompt;
          setRenamePrompt(undefined);
          if (prompt) {
            const trimmed = values[0].trim();
            if (trimmed !== '') {
              const def = await runtime.agentRegistry.get(prompt.agentId);
              await runtime.agentRegistry.upsert(prompt.agentId, {
                ...def,
                name: trimmed,
              });
              await reload();
            }
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  listContent: {paddingBottom: 24},
  loader: {marginTop: 32},
  empty: {textAlign: 'center', padding: 32},
  tabHint: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 12,
    lineHeight: 16,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarIcon: {fontSize: 22},
  info: {flex: 1, minWidth: 0, gap: 4},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  name: {fontSize: 16, fontWeight: '600'},
  // 徽标胶囊形状对齐 SearchEnginesScreen 的 BuiltinTag；
  // 「内置」用 primary 色、「全部」用 muted 三级文本色。
  tagBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagBadgeText: {fontSize: 12, fontWeight: '600'},
  metaRow: {flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0},
  invalidBadge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  invalidBadgeText: {fontSize: 11, fontWeight: '600'},
  meta: {fontSize: 13, lineHeight: 18},
  menuDots: {fontSize: 18, paddingHorizontal: 4},
  chevron: {fontSize: 22, fontWeight: '300'},
});
