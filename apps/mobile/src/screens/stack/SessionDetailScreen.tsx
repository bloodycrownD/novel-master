/**
 * 会话详情页（mobile）：参考 iOS 设置页 / QQ 详情页的卡片式交互。
 *
 * - 聊天名是大字标题，点一下直接 inline 编辑（TextInput），失焦或回车提交，
 *   不再单独弹弹层，也不需要"点击编辑"这种提示文字。
 * - 当前智能体 / 当前大模型各是一张卡片：左侧头像 icon、中间是 label + 取值、
 *   右侧是 › chevron 暗示可点；锁定时 chevron 换成 🔒，并整体降透明度。
 *
 * 锁定 / 待重选规则（与 desktop SessionDetailDrawer 对齐）：
 * - `source === 'session'` → agent / model 都允许在会话内切（model 仍受 agent-pin 压制）。
 * - `source === 'none'`（agent 解析失败，例如会话 agentId 指向已删 agent）→
 *   智能体卡放开为「待重选」：可点击弹 picker 重选，写入新 agentId 后悬空
 *   即解除；模型卡保持锁定（智能体没了，pin 的模型无从解析，重选后自然解锁）。
 * - meta 还没加载出来时不渲染卡片（停在加载态），天然不会被误点。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Alert, DeviceEventEmitter, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {ABORT_KEY} from '@novel-master/core/abort';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import Animated, {useAnimatedStyle} from 'react-native-reanimated';
import {useReanimatedKeyboardAnimation} from 'react-native-keyboard-controller';
import {KeyboardAvoidingView} from 'react-native-keyboard-controller';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {ManualCompactionService, type ManualCompactionHooks} from '../../services/manual-compaction.service';
import {AgentPickerModal} from '../../components/agent/AgentPickerModal';
import {ModelPickerModal} from '../../components/provider/ModelPickerModal';
import {useRuntime} from '../../hooks/useRuntime';
import {AGENT_LOCK_TOAST_STATEMENT, AGENT_RESELECT_HINT, ChatAgentMeta, MODEL_LOCK_TOAST} from '../../services/chat-agent-meta';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {ToastMessage} from '../../errors/toast-message';
import {coreT} from '../../i18n/core';
import {agentActivity} from '../../runtime/agent-activity';
import {ProjectComposerStatusService} from '../../services/project-composer-status.service';
import type {RootStackParamList} from '../../navigation/types';

type ScreenRoute = RouteProp<RootStackParamList, 'SessionDetail'>;
type ScreenNavigation = NativeStackNavigationProp<RootStackParamList, 'SessionDetail'>;

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
  // 手动压缩在途：压缩卡片就地换成取消入口（signal-abort-scope Step 14）。
  const [compacting, setCompacting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const session = await runtime.sessions.get(sessionId);
      if (!session.ok) {
        showToast(ToastMessage.toast(coreT({key: "ui.session.detail_load_failed"}), session.error));
        return;
      }
      setSessionTitle(session.value.title ?? '');
      const agentMeta = await ChatAgentMeta.load(runtime, projectId, sessionId);
      // 非 agent 解析类失败（Result.err，错误通道迁移四期）与未知异常同终端。
      if (!agentMeta.ok) {
        showToast(ToastMessage.toast(coreT({key: "ui.session.detail_load_failed"}), agentMeta.error));
        return;
      }
      setMeta(agentMeta.value);
    } catch (error) {
      showToast(ToastMessage.toast(coreT({key: "ui.session.detail_load_failed"}), error));
    } finally {
      setLoading(false);
    }
  }, [runtime, projectId, sessionId, showToast]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  // 锁定判据统一收口到 chat-agent-meta 的 helper：agent 卡看 isAgentLocked
  // （仅 meta 未加载时锁，none 态放开为待重选），model 卡看 isModelLocked
  // （none 态仍锁，重选智能体后自然解锁）。
  const agentLocked = ChatAgentMeta.isLocked(meta);
  const modelLocked = ChatAgentMeta.isModelLocked(meta);

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
        showToast(coreT({key: "ui.common.renamed"}));
      } catch (error) {
        showToast(ToastMessage.toast(coreT({key: "ui.common.rename_failed"}), error));
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
      // meta 尚未加载完，还不知道智能体状态，先锁住防误点。
      showToast(AGENT_LOCK_TOAST_STATEMENT);
      return;
    }
    // 原绑定智能体已被删除：不早退，直接弹 picker 让用户重选
    // （卡片 badge 已提示「已删除 · 点击重选」，不再额外弹 toast）。
    setAgentPickerOpen(true);
  }, [agentLocked, meta, showToast]);

  const openModelPicker = useCallback(() => {
    if (modelLocked) {
      showToast(MODEL_LOCK_TOAST);
      return;
    }
    setModelPickerOpen(true);
  }, [modelLocked, showToast]);

  // 压缩上下文：与聊天页 useChatTabMessages.handleCompactSession 对齐。
  // 1) Agent 运行中拒压缩（进程级标记 agentActivity.isActive，详情页没有聊天页的 uiRunning，
  //    所以直接读进程级标记，StorageConfigScreen 也是这么判同步禁用的）；
  // 2) Alert 文案保持一致；
  // 3) 成功后同样调 refreshComposerStatusAfterFloorOrCompaction 刷新 composer 状态。
  const handleCompact = useCallback(() => {
    if (compacting) {
      // 在途时压缩卡片已就地变成取消入口（handleCancelCompaction），走不到这里。
      return;
    }
    if (agentActivity.isActive()) {
      showToast(ToastMessage.toast(coreT({key: "ui.common.please_wait"}), coreT({key: "ui.chat.agent_running_compact_blocked"})));
      return;
    }
    Alert.alert(coreT({key: "ui.session.compact_context"}), coreT({key: "ui.session.compact_confirm_msg"}), [
      {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
      {
        text: '压缩',
        onPress: () => {
          setCompacting(true);
          // 编排收在 runManualCompaction（r3-orc-1：与聊天页那份手工副本曾
          // 漂移五处），本处只留 UI 尾巴——三出口（成功 / 明确失败 / 抛错）
          // 一个不能少。token 读数不做显式预热（2026-10-07 拍板，与置位同
          // 路径）：toast 即回，聊天页自己收到转录变更后按常规两阶段刷 chip。
          const compactionHooks: ManualCompactionHooks = {
            onFailed: error => {
              showToast(error === undefined ? ToastMessage.toast('压缩失败') : ToastMessage.toast('压缩失败', error));
            },
            onSucceeded: async () => {
              await ProjectComposerStatusService.refreshAfterFloorOrCompaction({
                projectId,
                sessionId,
              });
              showToast(coreT({key: "ui.chat.compact_done"}));
              // 通知聊天页刷新消息列表（压缩后旧消息 hidden 已置 true，聊天页需
              // reload 才能渲染降透明度；chip 顺带走常规两阶段刷新）。
              DeviceEventEmitter.emit('session-transcript-changed', {
                sessionId,
              });
            },
            onFinally: async () => {
              await load();
            },
          };
          // 取消走返回值（Outcome.cancelled/replaced）：只留「已取消压缩」提示
          // （不是错误 toast）。编排内部已自吞业务失败与尾巴抛错，这里的 catch
          // 只防御未来改动引入的意外异常，绝不重新抛出——调用方是 void，重抛
          // 就是 unhandled rejection。
          void ManualCompactionService.run(runtime, {projectId, sessionId}, compactionHooks)
            .then(outcome => {
              if (outcome.kind === 'cancelled' || outcome.kind === 'replaced') showToast(coreT({key: "ui.chat.compact_cancelled"}));
            })
            .catch((error: unknown) => {
              showToast(ToastMessage.toast('压缩失败', error));
            })
            .finally(() => {
              setCompacting(false);
            });
        },
      },
    ]);
  }, [compacting, runtime, sessionId, projectId, showToast, load]);

  // 压缩在途的取消入口（signal-abort-scope Step 14）：key 由 runManualCompaction
  // 注册；可中断窗口是「入口 + hide 开始前」，hide 之后取消无效、压缩照常跑完。
  const handleCancelCompaction = useCallback(() => {
    runtime.abortRegistry.abort(ABORT_KEY.compaction(sessionId));
  }, [runtime, sessionId]);

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
          <Text style={{color: tokens.textSecondary}}>{coreT({key: "ui.common.loading"})}</Text>
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
      keyboardShouldPersistTaps="never"
      // ↑ 失焦提交的关键：编辑态（键盘弹起）时点击任意位置由 ScrollView capture
      // 抢 responder → 收键盘 + blur → onEndEditing 触发 commitTitle，改名才提交。
      // 之前用 "handled" 时点击被本页五张 Pressable 卡片在 bubble 阶段抢走，
      // ScrollView 永不执行 blurTextInput → 输入框永不失焦 → 重命名提交不了。
      // 非编辑态无焦点输入框，capture 不生效（_keyboardIsDismissable=false），
      // 卡片仍是单次点击即达，行为零变化。
    >
      {/* 聊天名：大字标题 + 弱化铅笔暗示可编辑，点击切到 TextInput inline 编辑。 */}
      <View style={styles.titleBlock}>
        {editingTitle ? (
          <TextInput
            testID="session-title-input"
            style={[styles.titleInput, {color: tokens.text, borderColor: tokens.border}]}
            value={titleDraft}
            autoFocus
            onChangeText={setTitleDraft}
            onSubmitEditing={() => commitTitle(titleDraft)}
            onEndEditing={() => commitTitle(titleDraft)}
            placeholder={coreT({key: "ui.session.name_placeholder"})}
            placeholderTextColor={tokens.textTertiary}
            accessibilityLabel={coreT({key: "ui.session.name_input_aria"})}
          />
        ) : (
          <Pressable testID="session-title" onPress={startEditTitle} accessibilityLabel={coreT({key: "ui.session.rename_title"})} style={styles.titleRow}>
            <Text style={[styles.titleValue, {color: tokens.text}]} numberOfLines={2}>
              {sessionTitle || coreT({key: "ui.session.untitled"})}
            </Text>
            <Text style={[styles.titleEditGlyph, {color: tokens.textTertiary}]}>✎</Text>
          </Pressable>
        )}
      </View>

      {/* 当前智能体：点击直接弹 AgentPickerModal；none 态（已删）放开为待重选。 */}
      <Pressable
        testID="agent-row"
        onPress={openAgentPicker}
        accessibilityLabel={coreT({key: "ui.session.switch_agent"})}
        style={[
          styles.card,
          cardShadow,
          {
            backgroundColor: tokens.surface,
            borderColor: tokens.borderLight,
            opacity: agentLocked ? 0.6 : 1,
          },
        ]}
      >
        <View style={[styles.iconBox, {backgroundColor: tokens.primary + '1A'}]}>
          <Text style={styles.iconGlyph}>🤖</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={[styles.cardLabel, {color: tokens.textSecondary}]}>{coreT({key: "ui.session.current_agent"})}</Text>
          <Text style={[styles.cardValue, {color: tokens.text}]} numberOfLines={1}>
            {meta.agentName}
          </Text>
          {ChatAgentMeta.isDeleted(meta) ? <Text style={[styles.lockHint, {color: tokens.textTertiary}]}>{AGENT_RESELECT_HINT}</Text> : null}
        </View>
        <Text style={[styles.chevron, {color: tokens.textTertiary}]}>{agentLocked ? '🔒' : '›'}</Text>
      </Pressable>

      {/* 当前大模型：点击直接弹 ModelPickerModal，locked 时仅提示。 */}
      <Pressable
        testID="model-row"
        onPress={openModelPicker}
        accessibilityLabel={coreT({key: "ui.session.switch_model"})}
        style={[
          styles.card,
          cardShadow,
          {
            backgroundColor: tokens.surface,
            borderColor: tokens.borderLight,
            opacity: modelLocked ? 0.6 : 1,
          },
        ]}
      >
        <View style={[styles.iconBox, {backgroundColor: tokens.primary + '1A'}]}>
          <Text style={styles.iconGlyph}>⚡</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={[styles.cardLabel, {color: tokens.textSecondary}]}>{coreT({key: "ui.session.current_model"})}</Text>
          <Text style={[styles.cardValue, {color: tokens.text}]} numberOfLines={1}>
            {meta.modelLabel}
          </Text>
        </View>
        <Text style={[styles.chevron, {color: tokens.textTertiary}]}>{modelLocked ? '🔒' : '›'}</Text>
      </Pressable>

      {/* 查看提示词：跳转到 RealPromptScreen，预览当前会话实际发送的提示词。 */}
      <Pressable
        testID="real-prompt-row"
        onPress={() =>
          // AM-3：scope 走路由参数。不传的话屏内回落读全局 scope，后台通知栈外改过
          // scope 时就会显示别的会话的提示词（同页「聊天记录」入口一直传了）。
          navigation.navigate('RealPrompt', {projectId, sessionId})
        }
        accessibilityLabel={coreT({key: "ui.nav.view_prompt"})}
        style={[
          styles.card,
          cardShadow,
          {
            backgroundColor: tokens.surface,
            borderColor: tokens.borderLight,
          },
        ]}
      >
        <View style={[styles.iconBox, {backgroundColor: tokens.primary + '1A'}]}>
          <Text style={styles.iconGlyph}>📄</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={[styles.cardLabel, {color: tokens.textSecondary}]}>{coreT({key: "ui.nav.view_prompt"})}</Text>
          <Text style={[styles.cardValue, {color: tokens.text}]}>{coreT({key: "ui.session.view_prompt_value"})}</Text>
        </View>
        <Text style={[styles.chevron, {color: tokens.textTertiary}]}>›</Text>
      </Pressable>

      {/* 压缩上下文：发 SESSION_COMPACTION_REQUESTED 事件，与聊天页抽屉入口一致。
          在途时同一张卡片就地换成「取消压缩」入口（Step 14 真实取消）。 */}
      {compacting ? (
        <Pressable
          testID="compact-cancel-row"
          onPress={handleCancelCompaction}
          accessibilityLabel={coreT({key: "ui.session.cancel_compact"})}
          style={[
            styles.card,
            cardShadow,
            {
              backgroundColor: tokens.surface,
              borderColor: tokens.borderLight,
            },
          ]}
        >
          <View style={[styles.iconBox, {backgroundColor: tokens.primary + '1A'}]}>
            <Text style={styles.iconGlyph}>🗜️</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={[styles.cardLabel, {color: tokens.textSecondary}]}>{coreT({key: "ui.session.compact_context"})}</Text>
            <Text style={[styles.cardValue, {color: tokens.text}]}>{coreT({key: "ui.session.compacting"})}</Text>
          </View>
          <Text style={[styles.cancelAction, {color: tokens.danger}]}>{coreT({key: "ui.common.cancel"})}</Text>
        </Pressable>
      ) : (
        <Pressable
          testID="compact-row"
          onPress={handleCompact}
          accessibilityLabel={coreT({key: "ui.session.compact_context"})}
          style={[
            styles.card,
            cardShadow,
            {
              backgroundColor: tokens.surface,
              borderColor: tokens.borderLight,
            },
          ]}
        >
          <View style={[styles.iconBox, {backgroundColor: tokens.primary + '1A'}]}>
            <Text style={styles.iconGlyph}>🗜️</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={[styles.cardLabel, {color: tokens.textSecondary}]}>{coreT({key: "ui.session.compact_context"})}</Text>
            <Text style={[styles.cardValue, {color: tokens.text}]}>{coreT({key: "ui.session.compact_value"})}</Text>
          </View>
          <Text style={[styles.chevron, {color: tokens.textTertiary}]}>›</Text>
        </Pressable>
      )}

      {/* 技能：点击进会话技能面板。 */}
      <Pressable
        testID="skills-row"
        onPress={() => navigation.navigate('SkillPanel', {projectId})}
        accessibilityLabel={coreT({key: "ui.nav.skills"})}
        style={[
          styles.card,
          cardShadow,
          {
            backgroundColor: tokens.surface,
            borderColor: tokens.borderLight,
          },
        ]}
      >
        <View style={[styles.iconBox, {backgroundColor: tokens.primary + '1A'}]}>
          <Text style={styles.iconGlyph}>🧩</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={[styles.cardLabel, {color: tokens.textSecondary}]}>{coreT({key: "ui.nav.skills"})}</Text>
          <Text style={[styles.cardValue, {color: tokens.text}]}>{coreT({key: "ui.session.skills_value"})}</Text>
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
        <Animated.View style={[styles.scroll, clipStyle]}>{scrollBody}</Animated.View>
      )}

      <ModelPickerModal visible={modelPickerOpen} sessionId={sessionId} onClose={() => setModelPickerOpen(false)} onSelected={() => load().catch(() => undefined)} />
      <AgentPickerModal visible={agentPickerOpen} sessionId={sessionId} onClose={() => setAgentPickerOpen(false)} onSelected={() => load().catch(() => undefined)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  scroll: {flex: 1},
  scrollContent: {paddingHorizontal: 16, paddingTop: 32, paddingBottom: 40},
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
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
  // 压缩在途的右侧文字按钮。
  cancelAction: {fontSize: 15, fontWeight: '600'},
  lockHint: {fontSize: 12, marginTop: 4, lineHeight: 16},
});
