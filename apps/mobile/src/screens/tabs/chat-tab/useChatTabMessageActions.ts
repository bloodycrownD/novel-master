/**
 * Chat tab message actions: compact, fork, rollback, set-floor, edit, copy.
 */
import type {Result} from '@novel-master/core/errors';
import {AppError} from '@novel-master/core/errors';
import {useCallback, useRef} from 'react';
import {Alert} from 'react-native';
import {ABORT_KEY} from '@novel-master/core/abort';
import Clipboard from '@react-native-clipboard/clipboard';
import {RollbackConfirmView} from '@novel-master/core/presentation/chat/rollback-confirm.js';
import {type ChatMessageData, ChatMessage, AttachmentXmlCodec} from '@novel-master/core/chat';

import {FormatError} from '@/errors/format-error';
import {chatTranslator} from '@/i18n/chat';
import {ToastMessage} from '@/errors/toast-message';
import {MessageEdit} from '@/components/chat/message-edit';
import {RollbackErrorGuards} from '@novel-master/core/message-checkpoint';
import {chatAnnotateDraftStore} from '@novel-master/core/chat';
import {ChatComposerDraft} from '@/storage/chat-composer-draft';
import {ProjectComposerStatusService} from '@/services/project-composer-status.service';
import type {RollbackOptions} from '@novel-master/core/message-checkpoint';
import {MessageRollbackService} from '@/services/message-rollback.service';
import {ManualCompactionService, type ManualCompactionHooks} from '@/services/manual-compaction.service';
import {resetRollbackTiming, rollbackTimingLog} from '@/debug/run-timing';
import type {SnapshotCompleteSignal} from '@/services/snapshot-complete-signal';
import type {MobileNovelMasterRuntime} from '@/runtime/types';
import type {ChatSubview, ConversationPanel} from './useChatTabScope';

type UseChatTabMessageActionsParams = {
  runtime: MobileNovelMasterRuntime;
  projectId: string | undefined;
  sessionId: string | undefined;
  /** 消息显示源（Step 7 收口：manager 消息快照经 ctx 传入）。 */
  chatMessages: readonly ChatMessageData[];
  /** 操作后 force 回源刷新消息面（manager 路径）。 */
  reloadMessages: (force?: boolean) => Promise<unknown>;
  /** 编辑消息恢复草稿的 UI 令牌递增。 */
  setDraftRestoreToken: (updater: (token: number) => number) => void;
  agentRunning: boolean;
  resetStreamingDisplay: () => void;
  /** Toast 宿主支持可选行动按钮：手动压缩在途的「取消压缩」入口靠它承载。 */
  showToast: (message: string, options?: {actionLabel?: string; onAction?: () => void}) => void;
  refreshChatTokenLabel: () => Promise<void>;
  /**
   * 快照完成信号（rollback-large-jank Step 5）：回滚链的 token 全量重算
   * 错峰到「reloadMessages 触发的快照末片 post + deferred 排空」之后；
   * 缺省不传（测试/无 webview 场景）→ 保持现状时机立即刷新。
   */
  snapshotCompleteSignal?: SnapshotCompleteSignal;
  bumpWorktreeUiToken: () => void;
  reloadLists: () => Promise<Result<void, AppError>>;
  setCurrentSession: (sessionId: string) => Promise<void>;
  setChatSubview: (subview: ChatSubview) => void;
  setConversationPanel: (panel: ConversationPanel) => void;
  setMessageEditPrompt: (prompt: {messageId: string; initialText: string} | undefined) => void;
};

// nm-style: keep-public — React hook 状态边界；4 个 use-chat-tab-message-actions-* 测试直接 import 驱动，raw-console-baseline 锁文件路径，测试锁名
export function useChatTabMessageActions({
  runtime,
  projectId,
  sessionId,
  chatMessages,
  reloadMessages,
  setDraftRestoreToken,
  agentRunning,
  resetStreamingDisplay,
  showToast,
  refreshChatTokenLabel,
  snapshotCompleteSignal,
  bumpWorktreeUiToken,
  reloadLists,
  setCurrentSession,
  setChatSubview,
  setConversationPanel,
  setMessageEditPrompt,
}: UseChatTabMessageActionsParams) {
  // 手动压缩在途标记（signal-abort-scope Step 14）：在途时再点「压缩上下文」
  // 只把取消入口重新挂出来，不重复发起——同一 key 重复 register 会覆盖旧
  // scope，旧 scope 的取消就失效了。
  const compactionInFlightRef = useRef(false);

  const handleCompactSession = useCallback(() => {
    if (agentRunning) {
      showToast(ToastMessage.toast('请稍候', 'Agent 运行中无法压缩'));
      return;
    }
    if (projectId == null || sessionId == null) {
      return;
    }
    // 取消入口走 action toast（本屏反馈面就是 toast）：可中断窗口只有
    // 「入口 + hide 开始前」，action toast 的 8s 行动窗口与之匹配；hide 之后
    // 取消无效，压缩按原语义跑完（hide → invalidate → KKV 清理不可中断）。
    const showCompactionCancel = () => {
      showToast('正在压缩上下文…', {
        actionLabel: '取消压缩',
        onAction: () => {
          runtime.abortRegistry.abort(ABORT_KEY.compaction(sessionId));
        },
      });
    };
    if (compactionInFlightRef.current) {
      showCompactionCancel();
      return;
    }
    Alert.alert('压缩上下文', '将压缩上下文。是否继续？', [
      {text: '取消', style: 'cancel'},
      {
        text: '压缩',
        onPress: () => {
          compactionInFlightRef.current = true;
          showCompactionCancel();
          // 编排收在 runManualCompaction（r3-orc-1：详情页那份手工副本曾与
          // 之漂移五处），本处只留 UI 尾巴。token 读数不做显式预热（2026-10-07
          // 拍板，与置位同路径）：toast 即回，chip 由下面的 refresh 走常规
          // 两阶段（估算首帧 + 后台精确升级）自然到位。
          const compactionHooks: ManualCompactionHooks = {
            // 失败出口：压缩本体明确失败（error 为 undefined）才重载消息面
            // 并补刷 chip；抛错出口只弹提示（旧副本同款差异）。
            onFailed: error => {
              if (error === undefined) {
                void reloadMessages(true);
                void refreshChatTokenLabel();
                showToast(ToastMessage.toast('压缩失败'));
                return;
              }
              showToast(ToastMessage.toast('压缩失败', error));
            },
            onSucceeded: async () => {
              await reloadMessages(true);
              void refreshChatTokenLabel();
              await ProjectComposerStatusService.refreshAfterFloorOrCompaction({
                projectId,
                sessionId,
              });
              showToast('已压缩');
            },
          };
          // 取消走返回值（Outcome.cancelled/replaced）：只留「已取消压缩」提示
          // （不是错误 toast）。编排内部已自吞业务失败与尾巴抛错，这里的 catch
          // 只防御未来改动引入的意外异常，绝不重新抛出——调用方是 void，重抛
          // 就是 unhandled rejection。
          void ManualCompactionService.run(runtime, {projectId, sessionId}, compactionHooks)
            .then(outcome => {
              if (outcome.kind === 'cancelled' || outcome.kind === 'replaced') showToast('已取消压缩');
            })
            .catch((error: unknown) => {
              showToast(ToastMessage.toast('压缩失败', error));
            })
            .finally(() => {
              compactionInFlightRef.current = false;
            });
        },
      },
    ]);
  }, [agentRunning, projectId, sessionId, runtime, reloadMessages, refreshChatTokenLabel, showToast]);

  const handleForkFromMessage = useCallback(
    async (messageId: string) => {
      if (sessionId == null) {
        return;
      }
      if (agentRunning) {
        showToast(ToastMessage.toast('请稍候', 'Agent 运行中无法分叉'));
        return;
      }
      try {
        const forked = await runtime.messages.fork(sessionId, messageId);
        if (!forked.ok) {
          showToast(ToastMessage.toast('分叉失败', forked.error));
          return;
        }
        const lr = await reloadLists();
        if (!lr.ok) {
          showToast(ToastMessage.toast('分叉失败', lr.error));
          return;
        }
        await setCurrentSession(forked.value.id);
        setChatSubview('conversation');
        setConversationPanel('chat');
        resetStreamingDisplay();
        showToast(`已分叉：${forked.value.title ?? forked.value.id}`);
      } catch (error) {
        showToast(ToastMessage.toast('分叉失败', error));
      }
    },
    [sessionId, agentRunning, runtime, reloadLists, setCurrentSession, setChatSubview, setConversationPanel, resetStreamingDisplay, showToast],
  );

  const handleRollbackFromMessage = useCallback(
    (messageId: string) => {
      if (sessionId == null || projectId == null) {
        return;
      }
      if (agentRunning) {
        // run 在途时回滚不可用。toast 一闪即逝，用户极易错过、感知为
        // 「点了没反应/确认框迟迟不弹」——改用模态弹窗把原因说清楚。
        Alert.alert('暂时无法回滚', 'Agent 正在运行，请先停止生成或等本轮完成后再回滚。', [{text: '知道了', style: 'cancel'}]);
        return;
      }

      const target = chatMessages.find(m => m.id === messageId);
      if (target == null) {
        showToast(ToastMessage.toast('回滚失败', '消息不存在'));
        return;
      }

      // mode 与锚点角色一一对应（与 desktop applyUndoAnnotateRestore 的 anchorRole 对齐）：
      // - undo_send ↔ user 锚点：保留未发送草稿，在下方 applyComposerRestore 里从附件反投影
      // - rewind ↔ assistant 锚点：tail 里没有 user 消息，清空全部批注草稿（含未发送）
      const mode = ChatMessage.from(target).isUndoSendEligible() ? 'undo_send' : 'rewind';
      const restoreText = MessageEdit.editableTextFromMessage(target);
      // 删消息前 snapshot：undo_send 成功后仅解析批注（rewind / undo_send 均清空 ops store）
      const attachmentsSnapshot = mode === 'undo_send' ? target.attachments ?? [] : null;

      const applyComposerRestore = async () => {
        // Bug3：批注消息（restoreText 为 null）也要走反投影——拿掉 restoreText == null，
        // 仅在正文非空时才写 draft，批注反投影独立执行。
        if (mode !== 'undo_send') {
          return;
        }
        if (restoreText != null) {
          // T-TX2：仅正文（含 `@路径`）；无 attach chip
          // D1 带外路径：恢复文本没有确认区间 → **不传 tokenRanges**（undefined，
          // 非 `[]`），允许下一次水化兜底扫描一次。恢复的通常是完整历史明文，
          // 扫描升格面与旧行为相同，记入已知限制。
          const restoreDraft = {text: restoreText, attachments: []};
          ChatComposerDraft.writeState(sessionId, restoreDraft, runtime.sessions);
        }
        // 顺序：正文 → parseAnnotate → project + ∪ annotate（不映回 user_ops）
        if (attachmentsSnapshot != null) {
          const restoredAnnotate = AttachmentXmlCodec.decodeAnnotateDrafts(attachmentsSnapshot);
          for (const draft of restoredAnnotate) {
            chatAnnotateDraftStore.add(sessionId, draft);
          }
        }
        const status = await ProjectComposerStatusService.forSession(sessionId);
        ChatComposerDraft.applyComposerStatusAttachmentsReplace({
          sessionId,
          attachments: status,
        });
        setDraftRestoreToken(t => t + 1);
      };

      const runRollback = async (targetMessageId: string, options?: RollbackOptions) => {
        // 失败分流统一收口（错误通道迁移四期）：core 回滚的已知失败沿 Result
        // 到达，走同一套 backfill / 降级 / toast 分流；后段未知异常仍由下方
        // catch 进同一入口，两条通道终端一致。
        const onRollbackFailure = (error: unknown): void => {
          if (!options?.skipVfsReconcile && !options?.revisionHeadBackfill && RollbackErrorGuards.isRevisionBackfillRequired(error)) {
            const missingPaths = RollbackErrorGuards.readRevisionBackfillMissingPaths(error);
            Alert.alert('快照丢失', chatTranslator(RollbackConfirmView.descriptor(mode, 'backfill', {missingPaths})), [
              {text: '取消', style: 'cancel'},
              {
                text: '继续回滚',
                style: 'destructive',
                onPress: () => {
                  void runRollback(targetMessageId, {
                    revisionHeadBackfill: true,
                  }).catch(err => {
                    showToast(ToastMessage.toast('回滚失败', err));
                  });
                },
              },
            ]);
            return;
          }
          if (!options?.skipVfsReconcile && RollbackErrorGuards.isVfsDegradable(error)) {
            const errorMessage = FormatError.format(error);
            const confirmMessage = chatTranslator(RollbackConfirmView.descriptor(mode, 'degraded'));
            Alert.alert('无法恢复工作区', `${errorMessage}\n\n${confirmMessage}`, [
              {text: '取消', style: 'cancel'},
              {
                text: '仅删除后续对话',
                style: 'destructive',
                onPress: () => {
                  void runRollback(targetMessageId, {
                    skipVfsReconcile: true,
                  }).catch(err => {
                    showToast(ToastMessage.toast('回滚失败', err));
                  });
                },
              },
            ]);
            return;
          }
          showToast(ToastMessage.toast('回滚失败', error));
        };
        try {
          // 回滚链分段打点（rollback-large-jank Step 1）：t0 定在确认回滚、
          // core 调用发起前；各段耗时经 [nm-rollback] 轴输出（__DEV__ 门控，
          // 生产 no-op）。core 事务内部子步由 runtime 注入的 probe 同轴输出。
          resetRollbackTiming();
          rollbackTimingLog('core rollback begin');
          const rollbackResult = await MessageRollbackService.rollback(runtime, {projectId, sessionId}, targetMessageId, options);
          // 已知失败沿 Result 分流（错误通道迁移四期）：不再还原异常通道。
          if (!rollbackResult.ok) {
            onRollbackFailure(rollbackResult.error);
            return;
          }
          rollbackTimingLog('core rollback done');
          // assistant 锚点（rewind）：tail 里无 user 消息，没有 attach 可反投影，
          // 批注草稿应清空——与 user 锚点（undo_send）的反投影语义对称。
          // user 锚点（undo_send）的反投影在下方 applyComposerRestore 里处理：
          // 不清空 store，只把 parseAnnotateDraftsFromAttachments 的结果 add 进去，
          // 未发送草稿原样保留。
          if (mode === 'rewind') {
            chatAnnotateDraftStore.clear(sessionId);
          }
          // DB 截断事务已提交成功，后续刷新链（流式显示重置、tail
          // reload、composer 恢复、toast）不允许被 composer 状态刷新
          // 失败阻断——失败只记日志，列表照常刷新。
          try {
            await ProjectComposerStatusService.refreshAfterSessionKkvCleared({
              projectId,
              sessionId,
            });
          } catch (err) {
            console.warn('[rollback] composer status refresh failed', err);
          }
          rollbackTimingLog('composer status refreshed');
          resetStreamingDisplay();
          rollbackTimingLog('streaming display reset');
          const reloaded = await reloadMessages(true);
          rollbackTimingLog(Array.isArray(reloaded) ? `tail reload done (rows=${reloaded.length})` : 'tail reload done');
          await applyComposerRestore();
          rollbackTimingLog('composer restore done');
          showToast(options?.skipVfsReconcile ? '对话已截断，工作区未恢复' : '回滚成功');
          rollbackTimingLog('toast shown');
          // token 刷新错峰（rollback-large-jank Step 5）：等「reloadMessages
          // 触发的快照末片 post + deferred actions 排空」信号之后再发起
          // token 全量重算——快照构建/post 与 token 重算不再同窗口排队；
          // 信号迟到/超时兜底照旧刷新（回到现状时机，不悬挂）。toast 先于
          // 等待发出，回滚结果反馈不被错峰推迟。
          const tokenTrigger = snapshotCompleteSignal ? await snapshotCompleteSignal.consumeNext(1500) : 'no-signal';
          rollbackTimingLog(`token refresh trigger=${tokenTrigger}`);
          void refreshChatTokenLabel();
          rollbackTimingLog('token refresh scheduled');
        } catch (error) {
          // 后段未知异常（reloadMessages / composer 恢复等）与 Result 通道
          // 共用同一分流收口。
          onRollbackFailure(error);
        }
      };

      Alert.alert('回滚到此消息', chatTranslator(RollbackConfirmView.descriptor(mode, 'primary')), [
        {text: '取消', style: 'cancel'},
        {
          text: '回滚',
          style: 'destructive',
          onPress: () => {
            void runRollback(messageId).catch(err => {
              showToast(ToastMessage.toast('回滚失败', err));
            });
          },
        },
      ]);
    },
    [sessionId, projectId, agentRunning, chatMessages, runtime, reloadMessages, resetStreamingDisplay, showToast, setDraftRestoreToken, snapshotCompleteSignal],
  );

  const handleSetFloorFromMessage = useCallback(
    (messageId: string) => {
      if (sessionId == null || projectId == null) {
        return;
      }
      if (agentRunning) {
        showToast(ToastMessage.toast('请稍候', 'Agent 运行中无法置位'));
        return;
      }

      const runSetFloor = async () => {
        try {
          // clear rule_snapshot + file_cache 由 Core setMessageFloorAtMessage 完成
          const result = await runtime.messageTranscriptEffects.setMessageFloorAtMessage(projectId, sessionId, messageId);
          if (!result.ok) {
            showToast(ToastMessage.toast('置位失败', result.error));
            return;
          }
          await reloadMessages(true);
          bumpWorktreeUiToken();
          void refreshChatTokenLabel();
          await ProjectComposerStatusService.refreshAfterFloorOrCompaction({
            projectId,
            sessionId,
          });
          const changed = result.value.hiddenCount + result.value.shownCount;
          showToast(changed > 0 ? '已置位' : '上下文已是最新状态');
        } catch (error) {
          showToast(ToastMessage.toast('置位失败', error));
        }
      };

      Alert.alert('置位到此消息？', '此消息之前将不参与提示词，此消息及之后将恢复可见。', [
        {text: '取消', style: 'cancel'},
        {
          text: '置位',
          onPress: () => {
            void runSetFloor();
          },
        },
      ]);
    },
    [sessionId, projectId, agentRunning, runtime, reloadMessages, bumpWorktreeUiToken, refreshChatTokenLabel, showToast],
  );

  const handleMessageMenuAction = useCallback(
    (target: ChatMessageData, action: string) => {
      if (action === 'edit') {
        const initial = MessageEdit.editableTextFromMessage(target);
        if (initial == null) {
          showToast(ToastMessage.toast('无法编辑', '该消息没有可编辑的文本'));
          return;
        }
        // 编辑走 MessageEditModal，不写 Composer draft；否则取消后输入框会残留消息正文。
        setMessageEditPrompt({
          messageId: target.id,
          initialText: initial,
        });
      } else if (action === 'copy') {
        const text = MessageEdit.editableTextFromMessage(target);
        if (text == null) {
          showToast(ToastMessage.toast('无法复制', '该消息没有可复制的文本'));
          return;
        }
        Clipboard.setString(text);
        showToast('已复制');
      } else if (action === 'fork') {
        handleForkFromMessage(target.id).catch(() => undefined);
      } else if (action === 'set-floor') {
        handleSetFloorFromMessage(target.id);
      } else if (action === 'rollback') {
        handleRollbackFromMessage(target.id);
      }
    },
    [handleForkFromMessage, handleSetFloorFromMessage, handleRollbackFromMessage, sessionId, projectId, agentRunning, runtime, reloadMessages, refreshChatTokenLabel, setMessageEditPrompt, showToast],
  );

  const handleSaveMessageEdit = useCallback(
    async (messageId: string, text: string) => {
      const trimmed = text.trim();
      if (trimmed === '') {
        showToast(ToastMessage.toast('无法保存', '消息内容不能为空'));
        return;
      }
      const original = chatMessages.find(m => m.id === messageId);
      if (original == null) {
        showToast(ToastMessage.toast('保存失败', '消息不存在'));
        return;
      }
      try {
        await runtime.messages.updateContent(messageId, MessageEdit.applyTextEditToMessage(original, trimmed));
        await reloadMessages(true);
      } catch (error) {
        showToast(ToastMessage.toast('保存失败', error));
      }
    },
    [runtime, chatMessages, reloadMessages, showToast],
  );

  return {
    handleCompactSession,
    handleMessageMenuAction,
    handleSaveMessageEdit,
  };
}
