/**
 * Chat input: 大框 + 框内「更多 / @ / 发送」；attachments draft。
 */

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';

import Svg, {Path, Rect} from 'react-native-svg';

import {
  resolveComposerSendIntent,
  type MessageAttachment,
} from '@novel-master/core/chat';
import type {WorkplaceListRow} from '@novel-master/core/workplace';

import {useTheme} from '@/theme/ThemeProvider';

import {formatError} from '@/errors/format-error';

import type {AgentRunScope} from '@/services/agent-run.service';

import {useRuntime} from '@/hooks/useRuntime';

import {
  applyComposerStatusAttachmentsReplace,
  clearChatComposerDraft,
  hydrateChatComposerDraftFromDb,
  readChatComposerDraftState,
  refreshComposerAnnotateChips,
  subscribeChatComposerDraft,
  writeChatComposerDraftState,
} from '@/storage/chat-composer-draft';
import {
  clearChatAnnotateDrafts,
  hasChatAnnotateDrafts,
  listChatAnnotateDrafts,
  subscribeChatAnnotateDraft,
} from '@novel-master/core/chat';

import {projectComposerStatusForSession} from '@/services/project-composer-status.service';

import {ComposerStatusChips} from './AttachmentDraftChips';
import {
  ComposerAtPathInput,
  type ComposerAtPathInputHandle,
} from './ComposerAtPathInput';
import {AtPathTypeahead} from './AtPathTypeahead';
import {
  type AtPathRef,
  filterAtPathTypeaheadCandidates,
  findActiveAtQuery,
} from './composer-at-path';
import {composerDockBottomPadding} from './composer-dock-padding';
import {
  buildTokenInsertion,
  statusOnlyComposerAttachments,
} from './composer-token-insert';
import {useReanimatedKeyboardAnimation} from 'react-native-keyboard-controller';
import Animated, {useAnimatedStyle} from 'react-native-reanimated';
import {FileReferencePicker} from './FileReferencePicker';
import {SkillPicker} from '@/components/skills/SkillPicker';
import {SkillTypeahead, filterSkillTypeaheadCandidates} from './SkillTypeahead';
import type {EffectiveSkill} from '@novel-master/core/skills';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {resetRunTiming, timingLog} from '@/debug/run-timing';

type Props = {
  scope: AgentRunScope;

  hasModel: boolean;

  /** 当前会话 run 活跃（消费方从单元投影派生：status 为 starting|running）。 */
  running: boolean;

  onMessagesChanged: () => void | Promise<void>;

  onNeedModel: () => void;

  /** 末条为 user 时可空发续跑。 */
  canResumeWithoutInput: boolean;

  /** 末条为 plain user 文本时禁用输入。 */
  lastMessageIsPlainUserText: boolean;

  /** undo_send 回滚成功后递增，触发从 draft 刷新输入框。 */
  draftRestoreToken?: number;

  /** 打开更多菜单（压缩 / 模型 / Agent 等）。
   *
   * 暂未使用：工具栏「更多」按钮已注释隐藏，调用方也不再传该 prop。保留接口，
   * 后续若恢复按钮再从解构里取回即可。 */
  onOpenMore?: () => void;
};

export function ChatComposer({
  scope,
  hasModel,
  running,
  onMessagesChanged,
  onNeedModel,
  canResumeWithoutInput,
  lastMessageIsPlainUserText,
  draftRestoreToken,
}: Props) {
  const {tokens} = useTheme();
  const insets = useSafeAreaInsets();
  const runtime = useRuntime();
  // 键盘弹起时不再需要 safeAreaBottom padding——键盘已覆盖底部，
  // 多出来的 padding 会形成一道白条。
  const {height: keyboardHeightSV} = useReanimatedKeyboardAnimation();
  const dockPadRest = composerDockBottomPadding(insets.bottom);
  const dockPaddingBottom = useAnimatedStyle(() => {
    const kb = -keyboardHeightSV.value;
    // 键盘弹起（kb > 0）时 padding 归零；否则走 safeAreaBottom
    return {paddingBottom: kb > 0 ? 0 : dockPadRest};
  }, [keyboardHeightSV, dockPadRest]);
  const {sessionId} = scope;
  const initial = readChatComposerDraftState(sessionId);
  const [text, setText] = useState(initial.text);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([
    ...initial.attachments,
  ]);
  const [error, setError] = useState<string | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [typeaheadRows, setTypeaheadRows] = useState<WorkplaceListRow[]>([]);
  /** `$` 技能 typeahead 候选源（当前项目合并视图，不走会话工作区）。 */
  const [skillRows, setSkillRows] = useState<EffectiveSkill[]>([]);
  /** 文件批注 store 变更时 bump，驱动 hasAnnotateDrafts 重算。 */
  const [annotateEpoch, setAnnotateEpoch] = useState(0);
  const inputRef = useRef<TextInput>(null);
  /** 程序化插入 @path tag 走 mentions 提交路径。 */
  const atPathInputRef = useRef<ComposerAtPathInputHandle>(null);

  const streamHandlersRef = useRef({
    onMessagesChanged,
  });
  streamHandlersRef.current = {
    onMessagesChanged,
  };

  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  const activeAt = findActiveAtQuery(text, cursor);
  // `$` 技能引用查询（行首/空白/制表符边界，与 @ 同口径）
  const activeSkill = findActiveAtQuery(text, cursor, '$');

  const hasAnnotateDrafts = hasChatAnnotateDrafts(sessionId);
  void annotateEpoch;

  useEffect(() => {
    if (activeAt == null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const session = await runtimeRef.current.sessions.get(sessionId);
        const worktree = runtimeRef.current.workplace({
          kind: 'session',
          projectId: session.projectId,
          sessionId,
        });
        const rows = await worktree.buildListRows();
        if (!cancelled) {
          setTypeaheadRows(rows);
        }
      } catch {
        if (!cancelled) {
          setTypeaheadRows([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAt != null, sessionId]);

  // `$` 技能候选：当前项目合并视图（显式引用含已关闭技能，标注交给展示层）
  useEffect(() => {
    if (activeSkill == null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const list = await runtimeRef.current
          .skills()
          .effectiveSkills(scope.projectId);
        if (!cancelled) {
          setSkillRows(list);
        }
      } catch {
        if (!cancelled) {
          setSkillRows([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSkill != null, scope.projectId]);

  const typeaheadCandidates = (() => {
    if (activeAt == null) {
      return [] as AtPathRef[];
    }
    const refs: AtPathRef[] = typeaheadRows
      .filter(r => r.path !== '/')
      .map(r => ({
        path: r.path,
        kind: r.kind === 'dir' ? ('dir' as const) : ('file' as const),
      }));
    return filterAtPathTypeaheadCandidates(refs, activeAt.query, 5);
  })();

  const skillTypeaheadCandidates =
    activeSkill == null
      ? []
      : filterSkillTypeaheadCandidates(skillRows, activeSkill.query, 5);

  const persistDraft = useCallback(
    (nextText: string, nextAttachments: readonly MessageAttachment[]) => {
      writeChatComposerDraftState(
        sessionId,
        {
          text: nextText,
          attachments: nextAttachments,
        },
        runtimeRef.current.sessions,
      );
    },
    [sessionId],
  );

  /** 提交正文变更：mention 输入在位时整段写入（新 token 提成 mention），
   * 纯文本 fallback 时同步 draft（只留状态 chip）与光标。
   * mention:false 供 onChangeText 等回写路径使用——replaceCommittedText 会
   * 回调 onChangeText，再走 mention 分支会无限递归。 */
  const commitComposerText = useCallback(
    (next: string, nextCursor?: number, opts?: {mention?: boolean}) => {
      if (opts?.mention !== false && atPathInputRef.current) {
        atPathInputRef.current.replaceCommittedText(next, nextCursor);
        return;
      }
      setText(next);
      persistDraft(next, statusOnlyComposerAttachments(attachments));
      if (nextCursor != null) {
        setCursor(nextCursor);
      }
    },
    [attachments, persistDraft],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rt = runtimeRef.current;
      await hydrateChatComposerDraftFromDb(sessionId, rt.sessions);
      if (cancelled) {
        return;
      }
      try {
        const status = await projectComposerStatusForSession(rt, sessionId);
        if (cancelled) {
          return;
        }
        applyComposerStatusAttachmentsReplace({
          sessionId,
          attachments: status,
        });
      } catch {
        // 投影失败时仍用已水化的 attach+text
      }
      if (cancelled) {
        return;
      }
      const draft = readChatComposerDraftState(sessionId);
      setText(draft.text);
      setAttachments([...draft.attachments]);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, draftRestoreToken]);

  useEffect(() => {
    return subscribeChatComposerDraft(changedSessionId => {
      if (changedSessionId !== sessionId) {
        return;
      }
      const draft = readChatComposerDraftState(sessionId);
      setText(draft.text);
      setAttachments([...draft.attachments]);
    });
  }, [sessionId]);

  useEffect(() => {
    return subscribeChatAnnotateDraft(changedSessionId => {
      if (changedSessionId !== sessionId) {
        return;
      }
      refreshComposerAnnotateChips(sessionId);
      setAnnotateEpoch(n => n + 1);
    });
  }, [sessionId]);

  const executeRun = useCallback(
    async (content: string, allowResumeWithoutInput: boolean) => {
      timingLog('executeRun enter (tap→run dispatch gap)');
      setError(undefined);

      // 有正文 / 批注草稿 → 成功后清输入
      // annotate 仅在 onUserMessageAppended 清 store（与正文分轨可并存于回调）
      const shouldClearComposer = content.trim() !== '' || hasAnnotateDrafts;
      let composerCleared = false;
      const clearComposerNow = () => {
        if (composerCleared) {
          return;
        }
        composerCleared = true;
        clearChatComposerDraft(sessionId, runtime.sessions);
        setText('');
        setAttachments([]);
      };

      try {
        const stream = await runtime.preferences.getLlmStreamEnabled();
        timingLog('pref-read done');
        const annotateDrafts = listChatAnnotateDrafts(sessionId);
        // Step 6：发起改调 SessionStreamUnitManager——门禁由 manager 的
        // per-session 单元拒绝（返回明确错误），run 本体 fire-and-forget；
        // refcount 与收尾归 manager。受理同步触发投影通知（starting 即时
        // 可见），composer 侧不再需要乐观置位与收回（endUiRunOnError 语义
        // 随之退役——被拒/本地异常时投影从未变过）。
        const manager = runtime.sessionStreamUnitManager;
        if (manager == null) {
          throw new Error('运行时尚未就绪，请稍后重试');
        }
        const started = manager.startRun(sessionId, scope.projectId, content, {
          stream,
          allowResumeWithoutInput,
          annotateDrafts:
            annotateDrafts.length > 0 ? annotateDrafts : undefined,
          onUserMessageAppended: () => {
            // append 成功后再清输入 + 批注，避免失败时丢草稿
            clearChatAnnotateDrafts(sessionId);
            clearComposerNow();
            void Promise.resolve(
              streamHandlersRef.current.onMessagesChanged(),
            ).catch(() => undefined);
          },
          onSettled: () => {
            // 空续跑等路径可能不走 append 回调——结束后兑底清草稿
            if (shouldClearComposer) {
              clearComposerNow();
            }
            // 以投影为准刷新 chip（仅 annotate）
            void projectComposerStatusForSession(runtime, sessionId)
              .then(status => {
                applyComposerStatusAttachmentsReplace({
                  sessionId,
                  attachments: status,
                });
              })
              .catch(() => undefined);
            // 再刷一次列表：切走 / 无面板场景的补刷；停留当前面板时与
            // 单元消息管线的收尾 reload 双刷幂等（代价是多一次 DB 读，可接受）。
            void Promise.resolve(
              streamHandlersRef.current.onMessagesChanged(),
            ).catch(() => undefined);
          },
        });
        if (!started.ok) {
          // Manager 拒绝（同会话已有 run）：明确反馈（投影未变，无需收回）
          setError(started.error);
          return;
        }
      } catch (err) {
        // 本地异常（偏好读取失败 / runtime 未就绪等）：run 未受理，
        // 单元投影不受影响，只反馈错误
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          const detail =
            err instanceof Error
              ? {
                  name: err.name,
                  message: err.message,
                  stack: err.stack,
                  cause: String((err as Error & {cause?: unknown}).cause ?? ''),
                }
              : {name: typeof err, message: String(err)};
          console.error('[novel-master/chat] run failed', detail);
        }
        setError(formatError(err));
      }
    },
    [
      runtime,
      scope,
      sessionId,
      hasAnnotateDrafts,
    ],
  );

  const insertTokensIntoComposer = useCallback(
    (pathTokens: readonly string[]) => {
      if (pathTokens.length === 0) {
        return;
      }
      // 有未完成 @… 时从 @ 起替换到光标，避免残留半截查询
      const replaceStart = activeAt != null ? activeAt.start : cursor;
      const next = buildTokenInsertion(text, cursor, replaceStart, pathTokens);
      commitComposerText(next.text, next.cursor);
    },
    [activeAt, cursor, text, commitComposerText],
  );

  const applyTypeaheadToken = useCallback(
    (token: string) => {
      // 优先 mentions onSelect；失败再整段 replaceCommittedText
      if (atPathInputRef.current?.replaceActiveAt(token)) {
        return;
      }
      if (activeAt == null) {
        return;
      }
      const next = buildTokenInsertion(text, cursor, activeAt.start, token);
      commitComposerText(next.text, next.cursor);
    },
    [activeAt, cursor, text, commitComposerText],
  );

  /** `$` typeahead 点选：插 `$技能名` token（mention tag + 尾空格）。 */
  const applySkillTypeaheadToken = useCallback(
    (skillName: string) => {
      const token = `$${skillName}`;
      if (atPathInputRef.current?.replaceActiveAt(token, 'skill')) {
        return;
      }
      if (activeSkill == null) {
        return;
      }
      const next = buildTokenInsertion(text, cursor, activeSkill.start, token);
      commitComposerText(next.text, next.cursor);
    },
    [activeSkill, cursor, text, commitComposerText],
  );

  /** SkillPicker 单选：从光标（或活跃 `$` 查询）处插入 `$技能名` token。 */
  const insertSkillToken = useCallback(
    (skillName: string) => {
      const token = `$${skillName}`;
      // 有未完成 $… 时从 $ 起替换到光标，避免残留半截查询
      const replaceStart = activeSkill != null ? activeSkill.start : cursor;
      const next = buildTokenInsertion(text, cursor, replaceStart, token);
      commitComposerText(next.text, next.cursor);
    },
    [activeSkill, cursor, text, commitComposerText],
  );

  const sendIntent = useMemo(
    () =>
      resolveComposerSendIntent({
        text,
        attachments,
        canResumeWithoutInput,
        hasAnnotateDrafts,
        hasModel,
        running,
      }),
    [
      text,
      attachments,
      canResumeWithoutInput,
      hasAnnotateDrafts,
      hasModel,
      running,
    ],
  );

  const send = useCallback(async () => {
    // t0 钉在 onPress 第一行：executeRun 入口前的一切排队/前置都在表内
    resetRunTiming();
    if (!hasModel) {
      onNeedModel();
      return;
    }

    if (running) {
      // 双保险保留：running 时发送 = 停止（经 manager 的 abort 语义，
      // retain/freeze 时序由 core 负责；收尾照常走事件路径）。
      runtime.sessionStreamUnitManager.stopRun(sessionId);
      return;
    }

    const content = text.trim();
    const {hasSendable, allowResumeWithoutInput} = sendIntent;

    if (!hasSendable && !allowResumeWithoutInput) {
      return;
    }

    if (content && lastMessageIsPlainUserText) {
      return;
    }

    await executeRun(content, allowResumeWithoutInput);
  }, [
    runtime,
    sessionId,
    hasModel,
    running,
    text,
    canResumeWithoutInput,
    lastMessageIsPlainUserText,
    onNeedModel,
    executeRun,
    sendIntent,
  ]);

  const inputDisabled = !hasModel || running || lastMessageIsPlainUserText;
  const sendDisabled = sendIntent.sendDisabled;

  const inputPlaceholder = hasModel ? '输入消息…' : '选择模型后可发送';

  return (
    <Animated.View
      style={[
        styles.dock,
        {
          backgroundColor: tokens.background,
        },
        dockPaddingBottom,
      ]}
    >
      {!hasModel ? (
        <Pressable onPress={onNeedModel} style={styles.hintRow}>
          <Text style={{color: tokens.primary}}>请先选择工作区模型</Text>
        </Pressable>
      ) : null}

      {error ? (
        <Text style={[styles.error, {color: tokens.danger}]}>{error}</Text>
      ) : null}

      <View
        style={[
          styles.box,
          {backgroundColor: tokens.surface, borderColor: tokens.border},
        ]}
      >
        {/* 状态 chip 在输入框内顶部：不可叉；无文件引用 attach chip */}
        <ComposerStatusChips
          attachments={attachments}
          disabled={inputDisabled}
        />
        <AtPathTypeahead
          open={activeAt != null && !inputDisabled}
          candidates={typeaheadCandidates}
          onSelect={applyTypeaheadToken}
        />
        <SkillTypeahead
          open={activeSkill != null && !inputDisabled}
          candidates={skillTypeaheadCandidates}
          onSelect={applySkillTypeaheadToken}
        />
        <ComposerAtPathInput
          ref={atPathInputRef}
          inputRef={inputRef}
          testID="chat-composer-input"
          style={styles.input}
          placeholder={inputPlaceholder}
          placeholderTextColor={tokens.textSecondary}
          value={text}
          cursor={cursor}
          onChangeText={next => {
            commitComposerText(next, undefined, {mention: false});
          }}
          onSelectionChange={e => {
            setCursor(e.nativeEvent.selection.start);
          }}
          editable={!inputDisabled}
        />
        <View style={styles.toolbar}>
          {/* 「更多」按钮已隐藏：压缩上下文/切换智能体/模型等入口已迁移到会话详情页。
              代码保留，后续若有新功能需要此入口可恢复渲染。 */}
          {/*
          <Pressable
            onPress={onOpenMore}
            disabled={onOpenMore == null}
            style={[styles.toolBtn, { borderColor: tokens.border }]}
            accessibilityLabel="更多选项"
          >
            <Text style={{ color: tokens.textSecondary, fontSize: 18 }}>
              ⋯
            </Text>
          </Pressable>
          */}
          <View style={styles.toolbarSpacer} />
          <Pressable
            onPress={() => setPickerOpen(true)}
            disabled={inputDisabled}
            style={[styles.toolBtn, {borderColor: tokens.border}]}
            accessibilityLabel="引用文件"
          >
            <Text style={{color: tokens.textSecondary, fontSize: 16}}>@</Text>
          </Pressable>
          <Pressable
            onPress={() => setSkillPickerOpen(true)}
            disabled={inputDisabled}
            style={[styles.toolBtn, {borderColor: tokens.border}]}
            accessibilityLabel="引用技能"
          >
            <Text style={{color: tokens.textSecondary, fontSize: 16}}>$</Text>
          </Pressable>
          <Pressable
            onPress={send}
            disabled={sendDisabled}
            style={[
              styles.sendBtn,
              {
                backgroundColor: sendDisabled
                  ? tokens.border
                  : running
                  ? tokens.danger
                  : tokens.primary,
              },
            ]}
            accessibilityLabel={running ? '终止' : '发送'}
          >
            {running ? <TerminateIcon /> : <SendIcon />}
          </Pressable>
        </View>
      </View>

      <FileReferencePicker
        visible={pickerOpen}
        projectId={scope.projectId}
        sessionId={sessionId}
        onClose={() => setPickerOpen(false)}
        onConfirm={pathTokens => {
          insertTokensIntoComposer(pathTokens);
        }}
      />

      <SkillPicker
        visible={skillPickerOpen}
        projectId={scope.projectId}
        onClose={() => setSkillPickerOpen(false)}
        onConfirm={skillName => insertSkillToken(skillName)}
      />
    </Animated.View>
  );
}

function SendIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path
        d="M22 2L11 13"
        stroke="#fff"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M22 2L15 22L11 13L2 9L22 2Z"
        stroke="#fff"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function TerminateIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Rect x={6} y={6} width={12} height={12} rx={2} fill="#fff" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  dock: {
    flexShrink: 0,
    // 实底由 tokens.background 注入；盖住消息区溢出，键盘顶起时不透出
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 8,
  },
  hintRow: {
    marginBottom: 6,
  },
  error: {
    marginBottom: 6,
    fontSize: 13,
  },
  box: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 6,
  },
  input: {
    minHeight: 56,
    maxHeight: 160,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 4,
    paddingVertical: 6,
    width: '100%',
    textAlignVertical: 'top',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  toolbarSpacer: {
    flex: 1,
  },
  toolBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
