/**
 * 会话详情页（mobile）：参考 iOS 设置页 / QQ 详情页的卡片式交互。
 *
 * - 聊天名是大字标题，点一下直接 inline 编辑（TextInput），失焦或回车提交，
 *   不再单独弹弹层，也不需要"点击编辑"这种提示文字。
 * - 当前智能体 / 当前大模型各是一张卡片：左侧头像 icon、中间是 label + 取值、
 *   右侧是 › chevron 暗示可点；锁定时 chevron 换成 🔒，并整体降透明度。
 *
 * 锁定规则（与 desktop SessionDetailDrawer 对齐）：
 * - `source === 'session'` → agent / model 都允许在会话内切（model 仍受 agent-pin 压制）。
 * - `source === 'project-custom'` → 项目截断，agent / model 卡片都锁定，引导去项目设置改。
 * - `source === 'none'`（agent 解析失败，例如会话 agentId 指向已删 agent）→ 两张卡片都锁定，
 *   避免在异常态误操作。只有 session 才放开，所以锁定判据统一收口为 `source !== 'session'`。
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
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import {KeyboardAvoidingView} from 'react-native-keyboard-controller';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {AgentPickerModal} from '../../components/agent/AgentPickerModal';
import {ModelPickerModal} from '../../components/provider/ModelPickerModal';
import {useRuntime} from '../../hooks/useRuntime';
import {loadChatAgentMeta, type ChatAgentMeta} from '../../services/chat-agent-meta';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import type {RootStackParamList} from '../../navigation/types';

type ScreenRoute = RouteProp<RootStackParamList, 'SessionDetail'>;
type ScreenNavigation = NativeStackNavigationProp<
  RootStackParamList,
  'SessionDetail'
>;

const AGENT_LOCK_TOAST = '智能体已被项目锁定，无法在会话内切换，请到「项目智能体配置」修改';
const MODEL_LOCK_TOAST = '当前智能体已锁定模型，会话内无法覆盖';

export function SessionDetailScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const route = useRoute<ScreenRoute>();
  const navigation = useNavigation<ScreenNavigation>();
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

  // 锁定判据：只有 source='session' 才允许在会话内切，其余（project-custom / none）一律锁。
  // 这里把 agent 与 model 卡片按同一条件收口——否则 source='none' 时 modelSource 会被
  // chat-agent-meta.ts 回填为 'session'，只锁 agent 卡的话 model 卡仍然可点。
  // model 卡片额外在 agent-pin / hasDedicatedModel 时锁定（agent 自带 model 压制会话覆盖）。
  const notSession = meta?.source !== 'session';
  const agentLocked = notSession;
  const modelLocked =
    notSession ||
    meta?.modelSource === 'agent-pin' ||
    (meta?.hasDedicatedModel ?? false);

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

  // 卡片阴影样式：iOS 用 shadow*，Android 用 elevation，统一浮起感。
  const cardShadow = {
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  };

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      {/* 用 KeyboardAvoidingView 包裹 ScrollView，让聊天名 inline 编辑时
          软键盘弹起能抬升内容，TextInput 不被键盘盖住。 */}
      <KeyboardAvoidingView style={styles.scroll} behavior="padding">
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
        {/* 聊天名：大字标题 + 弱化铅笔暗示可编辑，点击切到 TextInput inline 编辑。 */}
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
              accessibilityLabel="编辑会话名称"
              style={styles.titleRow}>
              <Text
                style={[styles.titleValue, {color: tokens.text}]}
                numberOfLines={2}>
                {sessionTitle || '（未命名）'}
              </Text>
              <Text style={[styles.titleEditGlyph, {color: tokens.textTertiary}]}>
                ✎
              </Text>
            </Pressable>
          )}
        </View>

        {/* 当前智能体：点击直接弹 AgentPickerModal，locked 时仅提示。 */}
        <Pressable
          testID="agent-row"
          onPress={openAgentPicker}
          accessibilityLabel="切换智能体"
          style={[
            styles.card,
            cardShadow,
            {
              backgroundColor: tokens.surface,
              borderColor: tokens.borderLight,
              opacity: agentLocked ? 0.6 : 1,
            },
          ]}>
          <View
            style={[
              styles.iconBox,
              {backgroundColor: tokens.primary + '1A'},
            ]}>
            <Text style={styles.iconGlyph}>🤖</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={[styles.cardLabel, {color: tokens.textSecondary}]}>
              当前智能体
            </Text>
            <Text
              style={[styles.cardValue, {color: tokens.text}]}
              numberOfLines={1}>
              {meta.agentName}
            </Text>
            {agentLocked ? (
              <Text style={[styles.lockHint, {color: tokens.textTertiary}]}>
                {AGENT_LOCK_TOAST}
              </Text>
            ) : null}
          </View>
          <Text style={[styles.chevron, {color: tokens.textTertiary}]}>
            {agentLocked ? '🔒' : '›'}
          </Text>
        </Pressable>

        {/* 当前大模型：点击直接弹 ModelPickerModal，locked 时仅提示。 */}
        <Pressable
          testID="model-row"
          onPress={openModelPicker}
          accessibilityLabel="切换大模型"
          style={[
            styles.card,
            cardShadow,
            {
              backgroundColor: tokens.surface,
              borderColor: tokens.borderLight,
              opacity: modelLocked ? 0.6 : 1,
            },
          ]}>
          <View
            style={[
              styles.iconBox,
              {backgroundColor: tokens.primary + '1A'},
            ]}>
            <Text style={styles.iconGlyph}>⚡</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={[styles.cardLabel, {color: tokens.textSecondary}]}>
              当前大模型
            </Text>
            <Text
              style={[styles.cardValue, {color: tokens.text}]}
              numberOfLines={1}>
              {meta.modelLabel}
            </Text>
            {modelLocked ? (
              <Text style={[styles.lockHint, {color: tokens.textTertiary}]}>
                {MODEL_LOCK_TOAST}
              </Text>
            ) : null}
          </View>
          <Text style={[styles.chevron, {color: tokens.textTertiary}]}>
            {modelLocked ? '🔒' : '›'}
          </Text>
        </Pressable>

        {/* 聊天记录查询：跳转到 ChatHistorySearch 页面，参数与 SessionDetail 一致。 */}
        <Pressable
          testID="chat-history-row"
          onPress={() =>
            navigation.navigate('ChatHistorySearch', {projectId, sessionId})
          }
          accessibilityLabel="聊天记录查询"
          style={[
            styles.card,
            cardShadow,
            {
              backgroundColor: tokens.surface,
              borderColor: tokens.borderLight,
            },
          ]}>
          <View
            style={[
              styles.iconBox,
              {backgroundColor: tokens.primary + '1A'},
            ]}>
            <Text style={styles.iconGlyph}>🔍</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={[styles.cardLabel, {color: tokens.textSecondary}]}>
              聊天记录
            </Text>
            <Text style={[styles.cardValue, {color: tokens.text}]}>
              查询历史消息
            </Text>
          </View>
          <Text style={[styles.chevron, {color: tokens.textTertiary}]}>›</Text>
        </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

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
  scrollContent: {paddingHorizontal: 16, paddingTop: 32, paddingBottom: 40},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24},
  titleBlock: {marginBottom: 24, paddingHorizontal: 4},
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  titleValue: {flex: 1, fontSize: 24, fontWeight: '700'},
  // 右侧弱化铅笔，提示用户标题可点编辑；不喧宾夺主。
  titleEditGlyph: {fontSize: 16, fontWeight: '400'},
  titleInput: {
    fontSize: 22,
    fontWeight: '600',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  // 左侧头像容器：圆形 + 浅色 tint，给卡片"头像感"。
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: {fontSize: 20},
  cardBody: {flex: 1, gap: 2},
  cardLabel: {fontSize: 13, fontWeight: '500'},
  cardValue: {fontSize: 16, fontWeight: '600'},
  // 右侧 chevron / 锁图标，暗示是否可点。
  chevron: {fontSize: 18, fontWeight: '500'},
  lockHint: {fontSize: 12, marginTop: 4, lineHeight: 16},
});
