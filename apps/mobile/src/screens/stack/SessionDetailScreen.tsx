/**
 * 会话详情页（mobile）：收拢原 SessionActionsDrawer 五项能力。
 *
 * 承载：重命名 / 切模型 / 切智能体 / 查看提示词 / 压缩上下文。
 * agent/model 切换一律走 session 级绑定——传入 sessionId 后 picker
 * 写 session 绑定（selectSessionAgent / session model override），
 * 不再写 workspace 全局；workspace 全局入口在「我的」tab。
 *
 * 锁定规则（与 desktop SessionDetailDrawer 对齐）：
 * - `source === 'project-custom'` → agent 切换禁用（项目截断，引导去项目设置改）。
 * - `modelSource === 'agent-pin'` 或 agent definition 带 model pin → model 切换禁用。
 * - `source === 'session'` → agent 可切换（会话独立持有 agentId）。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Alert, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {EVENT_SESSION_COMPACTION_REQUESTED} from '@novel-master/core/events';
import {AgentPickerModal} from '../../components/agent/AgentPickerModal';
import {ModelPickerModal} from '../../components/provider/ModelPickerModal';
import {TextPromptModal} from '../../components/ui/TextPromptModal';
import {useRuntime} from '../../hooks/useRuntime';
import {loadChatAgentMeta, type ChatAgentMeta} from '../../services/chat-agent-meta';
import {refreshComposerStatusAfterFloorOrCompaction} from '../../services/project-composer-status.service';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import type {RootStackParamList} from '../../navigation/types';

type ScreenRoute = RouteProp<RootStackParamList, 'SessionDetail'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

/** agent 来源对应的中文标签（贴在 agent 名后面，帮用户判断当前生效来源）。 */
function agentSourceLabel(source: ChatAgentMeta['source']): string {
  switch (source) {
    case 'session':
      return '会话引用';
    case 'project-custom':
      return '项目专属';
    default:
      return '—';
  }
}

/** model 来源标签：agent pin 压制 / 会话跟随。 */
function modelSourceLabel(modelSource: ChatAgentMeta['modelSource']): string {
  switch (modelSource) {
    case 'agent-pin':
      return 'Agent 指定';
    default:
      return '会话';
  }
}

export function SessionDetailScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const route = useRoute<ScreenRoute>();
  const {projectId, sessionId} = route.params;

  const [sessionTitle, setSessionTitle] = useState<string>('');
  const [meta, setMeta] = useState<ChatAgentMeta | undefined>();
  const [loading, setLoading] = useState(true);
  const [renameOpen, setRenameOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [compacting, setCompacting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const session = await runtime.sessions.get(sessionId);
      setSessionTitle(session.title ?? '');
      const agentMeta = await loadChatAgentMeta(runtime, projectId, sessionId);
      setMeta(agentMeta);
    } catch (error) {
      showToast(toastMessage('加载会话详情失败', error));
    } finally {
      setLoading(false);
    }
  }, [runtime, projectId, sessionId, showToast]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  // project-custom 时 agent 被项目截断，不能在会话内改；agent pin 时 model 被锁。
  const agentLocked = meta?.source === 'project-custom';
  const modelLocked =
    meta?.modelSource === 'agent-pin' || (meta?.hasDedicatedModel ?? false);

  const handleRename = useCallback(
    async (nextTitle: string) => {
      try {
        await runtime.sessions.rename(sessionId, nextTitle);
        setSessionTitle(nextTitle);
        showToast('已重命名');
      } catch (error) {
        showToast(toastMessage('重命名失败', error));
      }
    },
    [runtime, sessionId, showToast],
  );

  const handleCompact = useCallback(() => {
    if (compacting) {
      return;
    }
    Alert.alert('压缩上下文', '将按照事件配置压缩上下文。是否继续？', [
      {text: '取消', style: 'cancel'},
      {
        text: '压缩',
        onPress: () => {
          void (async () => {
            setCompacting(true);
            try {
              const result = await runtime.eventOrchestrator.emit(
                EVENT_SESSION_COMPACTION_REQUESTED,
                {sessionId, projectId, trigger: 'manual'},
              );
              if (!result.ok) {
                showToast(
                  toastMessage('压缩部分失败', result.failures[0]?.error),
                );
              } else {
                await refreshComposerStatusAfterFloorOrCompaction(runtime, {
                  projectId,
                  sessionId,
                });
                showToast('已压缩');
              }
              await load();
            } catch (error) {
              showToast(toastMessage('压缩失败', error));
            } finally {
              setCompacting(false);
            }
          })();
        },
      },
    ]);
  }, [compacting, runtime, sessionId, projectId, showToast, load]);

  if (loading || meta == null) {
    return (
      <View style={[styles.root, {backgroundColor: tokens.background}]}>
        <View style={styles.center}>
          <Text style={{color: tokens.textSecondary}}>加载中…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, {color: tokens.textSecondary}]}>
            聊天名
          </Text>
          <Text style={[styles.titleValue, {color: tokens.text}]}>
            {sessionTitle || '（未命名）'}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, {color: tokens.textSecondary}]}>
            Agent
          </Text>
          <View style={styles.metaRow}>
            <Text style={[styles.metaValue, {color: tokens.text}]} numberOfLines={2}>
              {meta.agentName}
            </Text>
            <Text style={[styles.badge, {color: tokens.textTertiary}]}>
              {agentSourceLabel(meta.source)}
            </Text>
          </View>
          {agentLocked ? (
            <Text style={[styles.hint, {color: tokens.textTertiary}]}>
              项目专属智能体会截断会话级切换，请到「项目智能体配置」修改。
            </Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, {color: tokens.textSecondary}]}>
            大模型
          </Text>
          <View style={styles.metaRow}>
            <Text style={[styles.metaValue, {color: tokens.text}]} numberOfLines={2}>
              {meta.modelLabel}
            </Text>
            <Text style={[styles.badge, {color: tokens.textTertiary}]}>
              {modelSourceLabel(meta.modelSource)}
            </Text>
          </View>
          {modelLocked ? (
            <Text style={[styles.hint, {color: tokens.textTertiary}]}>
              当前 Agent 已指定模型，会话内无法覆盖。
            </Text>
          ) : null}
        </View>

        <View style={[styles.actions, {borderTopColor: tokens.border}]}>
          <DetailAction
            label="聊天重命名"
            tokens={tokens}
            onPress={() => setRenameOpen(true)}
          />
          <DetailAction
            label="切换大模型"
            tokens={tokens}
            disabled={modelLocked}
            hint={modelLocked ? 'Agent 已指定模型' : undefined}
            onPress={() => setModelPickerOpen(true)}
          />
          <DetailAction
            label="切换智能体"
            tokens={tokens}
            disabled={agentLocked}
            hint={agentLocked ? '项目专属已锁定' : undefined}
            onPress={() => setAgentPickerOpen(true)}
          />
          <DetailAction
            label="查看提示词"
            tokens={tokens}
            onPress={() => navigation.navigate('RealPrompt')}
          />
          <DetailAction
            label={compacting ? '压缩中…' : '压缩上下文'}
            tokens={tokens}
            disabled={compacting}
            onPress={handleCompact}
          />
        </View>
      </ScrollView>

      <TextPromptModal
        visible={renameOpen}
        title="重命名会话"
        label="会话名称"
        placeholder="输入会话名称"
        initialValue={sessionTitle}
        confirmLabel="保存"
        onClose={() => setRenameOpen(false)}
        onConfirm={handleRename}
      />
      <ModelPickerModal
        visible={modelPickerOpen}
        sessionId={sessionId}
        onClose={() => setModelPickerOpen(false)}
        onSelected={() => load().catch(() => undefined)}
      />
      <AgentPickerModal
        visible={agentPickerOpen}
        sessionId={sessionId}
        onClose={() => setAgentPickerOpen(false)}
        onSelected={() => load().catch(() => undefined)}
      />
    </View>
  );
}

/** 单行操作按钮：与原 SessionActionsDrawer 的列表项保持一致的视觉权重。 */
function DetailAction({
  label,
  tokens,
  onPress,
  disabled,
  hint,
}: {
  label: string;
  tokens: ReturnType<typeof useTheme>['tokens'];
  onPress: () => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <Pressable
      style={[styles.actionRow, {borderBottomColor: tokens.border}]}
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}>
      <Text
        style={{
          color: disabled ? tokens.textTertiary : tokens.text,
          fontSize: 15,
        }}>
        {label}
      </Text>
      {hint ? (
        <Text style={{color: tokens.textTertiary, fontSize: 12}}>{hint}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  scroll: {flex: 1},
  scrollContent: {paddingBottom: 32},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24},
  section: {paddingHorizontal: 16, paddingVertical: 12, gap: 4},
  sectionTitle: {fontSize: 12, fontWeight: '600', letterSpacing: 0.02},
  titleValue: {fontSize: 18, fontWeight: '600'},
  metaRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  metaValue: {flex: 1, fontSize: 15, fontWeight: '600'},
  badge: {fontSize: 12},
  hint: {fontSize: 12, marginTop: 2},
  actions: {marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth},
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
});
