/**
 * 会话详情页（mobile）：展示即操作，参考 QQ 详情页的交互。
 *
 * - 聊天名点击直接进入 inline 编辑（TextInput），失焦或回车提交，不再弹弹层。
 * - 当前智能体 / 当前大模型 各是一张可点击卡片，点击直接弹 picker 切换
 *   （agentLocked / modelLocked 时给提示，不进 picker）。
 * - 次要操作（查看提示词 / 压缩上下文 / 重命名弹层）已经由输入框旁边的 ⋯ 按钮
 *   弹出的 SessionActionsDrawer 承载，本页不再重复堆菜单列表。
 *
 * 锁定规则（与 desktop SessionDetailDrawer 对齐）：
 * - `source === 'project-custom'` → agent 切换禁用（项目截断，引导去项目设置改）。
 * - `modelSource === 'agent-pin'` 或 agent definition 带 model pin → model 切换禁用。
 * - `source === 'session'` → agent 可切换（会话独立持有 agentId）。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import {AgentPickerModal} from '../../components/agent/AgentPickerModal';
import {ModelPickerModal} from '../../components/provider/ModelPickerModal';
import {useRuntime} from '../../hooks/useRuntime';
import {loadChatAgentMeta, type ChatAgentMeta} from '../../services/chat-agent-meta';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import type {RootStackParamList} from '../../navigation/types';

type ScreenRoute = RouteProp<RootStackParamList, 'SessionDetail'>;

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

const AGENT_LOCK_TOAST = '项目专属智能体会截断会话级切换，请到「项目智能体配置」修改';
const MODEL_LOCK_TOAST = '当前 Agent 已指定模型，会话内无法覆盖';

export function SessionDetailScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const route = useRoute<ScreenRoute>();
  const {projectId, sessionId} = route.params;

  const [sessionTitle, setSessionTitle] = useState<string>('');
  const [meta, setMeta] = useState<ChatAgentMeta | undefined>();
  const [loading, setLoading] = useState(true);
  // 聊天名 inline 编辑态：editingTitle 打开时渲染 TextInput，titleDraft 暂存输入。
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);

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

  // 提交 inline 重命名：空串或未改动直接收起，不调 rename。
  const commitTitle = useCallback(
    async (raw: string) => {
      const next = raw.trim();
      setEditingTitle(false);
      if (!next || next === sessionTitle) {
        return;
      }
      try {
        await runtime.sessions.rename(sessionId, next);
        setSessionTitle(next);
        showToast('已重命名');
      } catch (error) {
        showToast(toastMessage('重命名失败', error));
      }
    },
    [runtime, sessionId, sessionTitle, showToast],
  );

  const startEditTitle = useCallback(() => {
    setTitleDraft(sessionTitle);
    setEditingTitle(true);
  }, [sessionTitle]);

  const openAgentPicker = useCallback(() => {
    if (agentLocked) {
      showToast(AGENT_LOCK_TOAST);
      return;
    }
    setAgentPickerOpen(true);
  }, [agentLocked, showToast]);

  const openModelPicker = useCallback(() => {
    if (modelLocked) {
      showToast(MODEL_LOCK_TOAST);
      return;
    }
    setModelPickerOpen(true);
  }, [modelLocked, showToast]);

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
        {/* 聊天名：展示态是大字标题，点击切到 TextInput inline 编辑。 */}
        <View style={styles.titleBlock}>
          {editingTitle ? (
            <TextInput
              testID="session-title-input"
              style={[
                styles.titleInput,
                {color: tokens.text, borderColor: tokens.border},
              ]}
              value={titleDraft}
              autoFocus
              onChangeText={setTitleDraft}
              onSubmitEditing={() => commitTitle(titleDraft)}
              onEndEditing={() => commitTitle(titleDraft)}
              placeholder="输入会话名称"
              placeholderTextColor={tokens.textTertiary}
              accessibilityLabel="会话名称输入框"
            />
          ) : (
            <Pressable
              testID="session-title"
              onPress={startEditTitle}
              accessibilityLabel="编辑会话名称">
              <Text
                style={[styles.titleValue, {color: tokens.text}]}
                numberOfLines={2}>
                {sessionTitle || '（未命名）'}
              </Text>
              <Text style={[styles.titleHint, {color: tokens.textTertiary}]}>
                点击编辑
              </Text>
            </Pressable>
          )}
        </View>

        {/* 当前智能体：点击直接弹 AgentPickerModal，locked 时仅提示。 */}
        <Pressable
          testID="agent-row"
          style={[styles.card, {backgroundColor: tokens.surface}]}
          onPress={openAgentPicker}
          accessibilityLabel="切换智能体">
          <View style={styles.cardHeader}>
            <Text style={[styles.cardLabel, {color: tokens.textSecondary}]}>
              当前智能体
            </Text>
            <Text style={[styles.badge, {color: tokens.textTertiary}]}>
              {agentSourceLabel(meta.source)}
            </Text>
          </View>
          <Text
            style={[styles.cardValue, {color: tokens.text}]}
            numberOfLines={2}>
            {meta.agentName}
          </Text>
          {agentLocked ? (
            <Text style={[styles.lockHint, {color: tokens.textTertiary}]}>
              {AGENT_LOCK_TOAST}
            </Text>
          ) : null}
        </Pressable>

        {/* 当前大模型：点击直接弹 ModelPickerModal，locked 时仅提示。 */}
        <Pressable
          testID="model-row"
          style={[styles.card, {backgroundColor: tokens.surface}]}
          onPress={openModelPicker}
          accessibilityLabel="切换大模型">
          <View style={styles.cardHeader}>
            <Text style={[styles.cardLabel, {color: tokens.textSecondary}]}>
              当前大模型
            </Text>
            <Text style={[styles.badge, {color: tokens.textTertiary}]}>
              {modelSourceLabel(meta.modelSource)}
            </Text>
          </View>
          <Text
            style={[styles.cardValue, {color: tokens.text}]}
            numberOfLines={2}>
            {meta.modelLabel}
          </Text>
          {modelLocked ? (
            <Text style={[styles.lockHint, {color: tokens.textTertiary}]}>
              {MODEL_LOCK_TOAST}
            </Text>
          ) : null}
        </Pressable>
      </ScrollView>

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

const styles = StyleSheet.create({
  root: {flex: 1},
  scroll: {flex: 1},
  scrollContent: {paddingHorizontal: 16, paddingTop: 20, paddingBottom: 32},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24},
  titleBlock: {marginBottom: 20},
  titleValue: {fontSize: 22, fontWeight: '700'},
  titleHint: {fontSize: 12, marginTop: 6},
  titleInput: {
    fontSize: 20,
    fontWeight: '600',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    gap: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardLabel: {fontSize: 13, fontWeight: '500'},
  cardValue: {fontSize: 16, fontWeight: '600'},
  badge: {fontSize: 12},
  lockHint: {fontSize: 12, marginTop: 4},
});
