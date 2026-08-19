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
 * - `source === 'none'`（agent 解析失败，例如会话 agentId 指向已删 agent）→ 两张卡片都锁定，
 *   避免在异常态误操作。只有 session 才放开，所以锁定判据统一收口为 `source !== 'session'`。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  Alert,
  DeviceEventEmitter,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import Animated, {useAnimatedStyle} from 'react-native-reanimated';
import {useReanimatedKeyboardAnimation} from 'react-native-keyboard-controller';
import {KeyboardAvoidingView} from 'react-native-keyboard-controller';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {runCompaction} from '@novel-master/core/compaction';
import {AgentPickerModal} from '../../components/agent/AgentPickerModal';
import {ModelPickerModal} from '../../components/provider/ModelPickerModal';
import {useRuntime} from '../../hooks/useRuntime';
import {
  isAgentLocked,
  isModelLocked,
  loadChatAgentMeta,
  type ChatAgentMeta,
} from '../../services/chat-agent-meta';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import {isMobileAgentActive} from '../../runtime/agent-activity';
import {refreshComposerStatusAfterFloorOrCompaction} from '../../services/project-composer-status.service';
import type {RootStackParamList} from '../../navigation/types';

type ScreenRoute = RouteProp<RootStackParamList, 'SessionDetail'>;
type ScreenNavigation = NativeStackNavigationProp<
  RootStackParamList,
  'SessionDetail'
>;

const AGENT_LOCK_TOAST = '当前会话未绑定有效智能体，无法在会话内切换。';
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

  // 锁定判据统一收口到 chat-agent-meta 的 helper：agent 卡看 isAgentLocked，
  // model 卡在 agent 锁的基础上再看 agent-pin / hasDedicatedModel。meta 还没加载
  // 出来时 helper 返回 true（锁定），避免异常态误点。
  const agentLocked = isAgentLocked(meta);
  const modelLocked = isModelLocked(meta);

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
        // 改名成功后广播，聊天页订阅 session-renamed 后刷新顶栏标题与列表。
        DeviceEventEmitter.emit('session-renamed', {sessionId, title: next});
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

  // 压缩上下文：与聊天页 useChatTabMessages.handleCompactSession 对齐。
  // 1) Agent 运行中拒压缩（进程级标记 isMobileAgentActive，详情页没有聊天页的 uiRunning，
  //    所以直接读进程级标记，StorageConfigScreen 也是这么判同步禁用的）；
  // 2) Alert 文案保持一致；
  // 3) 成功后同样调 refreshComposerStatusAfterFloorOrCompaction 刷新 composer 状态。
  const handleCompact = useCallback(() => {
    if (isMobileAgentActive()) {
      showToast(toastMessage('请稍候', 'Agent 运行中无法压缩'));
      return;
    }
    Alert.alert('压缩上下文', '将压缩上下文。是否继续？', [
      {text: '取消', style: 'cancel'},
      {
        text: '压缩',
        onPress: () => {
          void (async () => {
            try {
              const hideStartDepth =
                await runtime.compactionConditionEvaluator.getHideStartDepth();
              const result = await runCompaction(
                {
                  sessionKkv: runtime.sessionKkv,
                  messages: runtime.messages,
                  messageTranscriptEffects: runtime.messageTranscriptEffects,
                },
                {sessionId, projectId, hideStartDepth},
              );
              if (!result.ok) {
                showToast(toastMessage('压缩失败'));
              } else {
                await refreshComposerStatusAfterFloorOrCompaction(runtime, {
                  projectId,
                  sessionId,
                });
                showToast('已压缩');
                // 通知聊天页刷新消息列表（压缩后旧消息 hidden 已置 true，聊天页需 reload 才能渲染降透明度）
                DeviceEventEmitter.emit('session-transcript-changed', {sessionId});
              }
              await load();
            } catch (error) {
              showToast(toastMessage('压缩失败', error));
            }
          })();
        },
      },
    ]);
  }, [runtime, sessionId, projectId, showToast, load]);

  // Android 裁切窗口：与 ScreenFormLayout 同款——用 marginBottom 收缩键盘高度，
  // 内容区跟铉缩到键盘以上。不能只 translateY：ScrollView 高度不变的话顶部会被裁掉。
  const {height: keyboardHeightSV} = useReanimatedKeyboardAnimation();
  const clipStyle = useAnimatedStyle(() => {
    const kb = -keyboardHeightSV.value;
    return {marginBottom: kb};
  }, [keyboardHeightSV]);

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

  // 聊天名 inline 编辑时软键盘弹起要抬升内容，TextInput 不被键盘盖住。
  // iOS 走 KeyboardAvoidingView 的 padding；Android 上 react-native-keyboard-controller
  // 的 KeyboardAvoidingView behavior={undefined} 等于啥也不干，改用 Animated.View 的
  // marginBottom 收缩裁切窗口（与 ScreenFormLayout 同款范式 A）。
  const scrollBody = (
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

      {/* 查看提示词：跳转到 RealPromptScreen，预览当前会话实际发送的提示词。 */}
      <Pressable
        testID="real-prompt-row"
        onPress={() => navigation.navigate('RealPrompt')}
        accessibilityLabel="查看提示词"
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
          <Text style={styles.iconGlyph}>📄</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={[styles.cardLabel, {color: tokens.textSecondary}]}>
            查看提示词
          </Text>
          <Text style={[styles.cardValue, {color: tokens.text}]}>
            预览提示词
          </Text>
        </View>
        <Text style={[styles.chevron, {color: tokens.textTertiary}]}>›</Text>
      </Pressable>

      {/* 压缩上下文：发 SESSION_COMPACTION_REQUESTED 事件，与聊天页抽屉入口一致。 */}
      <Pressable
        testID="compact-row"
        onPress={handleCompact}
        accessibilityLabel="压缩上下文"
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
          <Text style={styles.iconGlyph}>🗜️</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={[styles.cardLabel, {color: tokens.textSecondary}]}>
            压缩上下文
          </Text>
          <Text style={[styles.cardValue, {color: tokens.text}]}>
            减少上下文占用
          </Text>
        </View>
        <Text style={[styles.chevron, {color: tokens.textTertiary}]}>›</Text>
      </Pressable>

      {/* 技能：点击进会话技能面板。 */}
      <Pressable
        testID="skills-row"
        onPress={() => navigation.navigate('SkillPanel', {projectId})}
        accessibilityLabel="技能"
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
          <Text style={styles.iconGlyph}>🧩</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={[styles.cardLabel, {color: tokens.textSecondary}]}>
            技能
          </Text>
          <Text style={[styles.cardValue, {color: tokens.text}]}>
            查看与管理
          </Text>
        </View>
        <Text style={[styles.chevron, {color: tokens.textTertiary}]}>›</Text>
      </Pressable>
    </ScrollView>
  );

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      {Platform.OS === 'ios' ? (
        <KeyboardAvoidingView style={styles.scroll} behavior="padding">
          {scrollBody}
        </KeyboardAvoidingView>
      ) : (
        <Animated.View style={[styles.scroll, clipStyle]}>
          {scrollBody}
        </Animated.View>
      )}

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
