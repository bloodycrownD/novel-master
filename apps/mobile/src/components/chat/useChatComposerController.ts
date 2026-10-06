/**
 * Composer 逻辑层（chat-webview-unify Step 7 拆出；composer-native-2026-10
 * Step 5 数据来源换向）—— **RN 侧 dock 域的一切真源**。
 *
 * ## 为什么要拆
 * dock 全区（chips / input / toolbar / typeahead 浮层）由 `NativeChatComposer`
 * 承接（原 Step 3/4 期间曾进 chat-conversation 文档，输入框原生化后回到 RN）。
 * 留在本 hook 的是三样东西：
 * 1. **发送决策**（`executeRun` / `send` 三分支 / `resolveComposerSendIntent`）；
 * 2. **草稿三订阅链**（水化 / `subscribeChatComposerDraft` / `subscribeChatAnnotateDraft`）；
 * 3. **候选源拉取**（`buildListRows` 过滤目录 → `AtPathRef[]` / `effectiveSkills`）。
 *
 * 这三样算完的产物组装成 `composerState` 供面板**直连** `NativeChatComposer`
 * 的 props（组件不做业务推导），另加键盘态 `keyboardUp` 与 `safeAreaBottom`。
 * 数据来源在 Step 5 换向（spec 变更点 #6）：打字/选区/dock 上行不再走桥
 * （`ChatConversationWebView` 已退为纯转录宿主），改为组件事件直连；命令式写入
 * 走组件 `ref.setText`（M7）。回调签名（onChangeText / onSelectionChange /
 * handleDockAction）保持不变——只是调用方从桥上行换成了组件 props。
 *
 * ## 三条纪律
 *
 * **(A) 打字真源在输入组件内部，`change` 只上抛不回写**（M6）。`onChangeText` 是
 * 唯一消费口：每键上行一条，落库即走。typeahead 点选 / 粘贴这类 **组件自治写入**
 * 由 `NativeChatComposer` 在命令式写入后补发一条 `change`（M7/E10/F6），本 hook
 * 一视同仁落库——**不区分来源**是这里最容易写错的地方：若按「来源是 Picker 就走
 * `insertTokens*`」分流，组件补发的那条就会漏落库。
 *
 * **(B) 键盘态只能由 UI 线程的**布尔翻转**驱动，禁止每帧 JS 读 SharedValue**。
 * `useReanimatedKeyboardAnimation()` 的 `height` 是每帧在变的 SharedValue；若在
 * render / effect 里直读它派生 state，就是「键盘动画期间每帧一次 RN 侧 setState +
 * 重渲染」。正确形态是 `useAnimatedReaction`（跑在 UI 线程）+ `runOnJS`（**仅在
 * 布尔翻转时**过桥）。翻转出的 `keyboardUp` 经 props 进 `NativeChatComposer`，
 * 由它做 dock 底 padding 的归零/回落（`resolveDockBottomPadding`）。
 *
 * **(C) typeahead 候选源按引用下发**。候选源内容不变时复用旧引用：`NativeChatComposer`
 * 的 typeahead 视图是 `useMemo`（依赖含 `typeaheadSource`），引用稳定就不过滤重算，
 * 浮层不会因无关重渲染闪动。
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAnimatedReaction, runOnJS} from 'react-native-reanimated';
import {useReanimatedKeyboardAnimation} from 'react-native-keyboard-controller';
import {
  clearChatAnnotateDrafts,
  hasChatAnnotateDrafts,
  listChatAnnotateDrafts,
  resolveComposerSendIntent,
  subscribeChatAnnotateDraft,
  type MessageAttachment,
} from '@novel-master/core/chat';
import type {EffectiveSkill} from '@novel-master/core/skills';
import type {AgentRunScope} from '@/services/agent-run.service';
import {useRuntime} from '@/hooks/useRuntime';
import {formatError} from '@/errors/format-error';
import {
  applyComposerStatusAttachmentsReplace,
  clearChatComposerDraft,
  hydrateChatComposerDraftFromDb,
  readChatComposerDraftState,
  refreshComposerAnnotateChips,
  subscribeChatComposerDraft,
  writeChatComposerDraftState,
} from '@/storage/chat-composer-draft';
import {projectComposerStatusForSession} from '@/services/project-composer-status.service';
import {findActiveAtQuery, type AtPathRef} from './composer-at-path';
import {
  buildTokenInsertion,
  statusOnlyComposerAttachments,
} from './composer-token-insert';
import type {ComposerInputSelection} from './ComposerInputBridge';
import {
  EMPTY_CONVERSATION_TYPEAHEAD_SOURCE,
  type ConversationDockAction,
  type ConversationTypeaheadSource,
} from './ChatConversationBridge';

/**
 * dock 全字段状态（composer-native-2026-10 Step 6 自 `ChatConversationBridge`
 * 迁入：本 hook 是它的唯一消费方——组装后面板按字段拆开直连
 * `NativeChatComposer` 的 props，不再经桥收发）。
 */
export type ConversationComposerState = {
  readonly inputDisabled: boolean;
  readonly hasModel: boolean;
  readonly sendDisabled: boolean;
  readonly running: boolean;
  readonly error?: string;
  readonly fullscreenEnabled: boolean;
  readonly placeholder: string;
  /**
   * 状态 chip 列表。**纯展示、不可点、不随 `inputDisabled` 置灰**——现网
   * `AttachmentDraftChips` 的 `disabled` 是透传后未使用的死参数。
   */
  readonly chips: readonly MessageAttachment[];
  /** 键盘态（RN 侧 `useReanimatedKeyboardAnimation` 派生）。 */
  readonly keyboardUp: boolean;
  /** typeahead 候选源。 */
  readonly typeahead: ConversationTypeaheadSource;
};
import {resetRunTiming, timingLog} from '@/debug/run-timing';

/** ⛶ 全屏编辑入口载荷：当前输入文本原样带给父层（父层负责导航与保存回填）。 */
export type ComposerFullscreenPayload = {text: string};

export type UseChatComposerControllerOptions = {
  /** 会话 scope（`AgentRunScope` = `{projectId, sessionId}`，两者皆必填）。 */
  readonly scope: AgentRunScope;
  /** 工作区有模型（hintRow 显隐的真源，**不能**用 `inputDisabled` 代替）。 */
  readonly hasModel: boolean;
  /** 当前会话 run 活跃（消费方从单元投影派生：status 为 starting|running）。 */
  readonly running: boolean;
  readonly onMessagesChanged: () => void | Promise<void>;
  readonly onNeedModel: () => void;
  /** 末条为 user 时可空发续跑。 */
  readonly canResumeWithoutInput: boolean;
  /** 末条为 plain user 文本时禁用输入。 */
  readonly lastMessageIsPlainUserText: boolean;
  /** undo_send 回滚成功后递增，触发从 draft 刷新输入框。 */
  readonly draftRestoreToken?: number;
  readonly onOpenComposerFullscreen?: (
    payload: ComposerFullscreenPayload,
  ) => void;
  /**
   * **M7 · 命令式整段写入通道**（composer-native-2026-10 Step 5 起的落点是
   * `NativeChatComposer` 的 `ref.setText`；Step 2~4 过渡期曾是宿主
   * `ChatConversationWebViewHandle.setComposerText`，桥侧下行已随 D4b 退役）。
   *
   * 为什么 Picker 路径必须走它而不是「改 text state 让组件的 value effect 下发」：
   * value effect 靠「外部直改 state」触发，命令式通道显式声明写入意图并携带光标，
   * 两条通道在组件内收敛到同一个 `commitExternalText` 内部实现（行为零差分），
   * 但命令式调用让「写入发生」这件事不依赖渲染时序，时序上更确定。
   *
   * 缺省时退化为「只改本地 state」（组件的 `value` prop 变化仍会经 effect 补写），
   * 供不挂输入组件的调用方（单测 / 降级）使用。
   */
  readonly setComposerText?: (text: string, cursor?: number) => void;
};

export type ChatComposerController = {
  /**
   * dock 域聚合状态：面板按字段拆开直连 `NativeChatComposer` 的 props
   * （类型载体仍是 `ConversationComposerState`，不再经桥收发）。
   */
  readonly composerState: ConversationComposerState;
  /** 输入框当前全文（外部真源草稿文本；**打字真源在输入组件内部编辑器态**）。 */
  readonly text: string;
  /** 外部受控光标（插入 token / 水化 / 清空后）：随外部 value 变化对齐一次。 */
  readonly cursor: number;
  /** 打字 / 命令式写入补发的唯一消费口（纪律 A：不区分来源）。 */
  readonly onChangeText: (text: string) => void;
  /** 选区变化上行消费口（`NativeChatComposer.onComposerSelectionChange` 直挂）。 */
  readonly onSelectionChange: (selection: ComposerInputSelection) => void;

  /** dock 上行处置（`NativeChatComposer.onDockAction` 直挂这个）。 */
  readonly handleDockAction: (action: ConversationDockAction) => void;
  readonly send: () => Promise<void>;
  readonly terminate: () => void;
  readonly needModel: () => void;
  readonly openFullscreen: () => void;

  readonly pickerOpen: boolean;
  readonly skillPickerOpen: boolean;
  readonly closeAtPicker: () => void;
  readonly closeSkillPicker: () => void;
  /** `@` Picker 选择确认 → 整段写入（经 M7 命令式通道）。 */
  readonly onAtPickerConfirm: (pathTokens: readonly string[]) => void;
  /** `$` Picker 选择确认 → 整段写入（经 M7 命令式通道）。 */
  readonly onSkillPickerConfirm: (skillName: string) => void;

  /**
   * typeahead 点选落文（Step 5 起 `NativeChatComposer.onTypeaheadSelect` 消费）：
   * `@` 侧整 token（含触发符），`$` 侧传剥掉触发符的技能名。两者经
   * `commitComposerText`（M7 命令式通道）落文，并替换活跃的半截查询。
   */
  readonly insertTokensIntoComposer: (pathTokens: readonly string[]) => void;
  readonly insertSkillToken: (skillName: string) => void;

  /** 安全区底部高度（`init.composer.safeAreaBottom` 的取值）。 */
  readonly safeAreaBottom: number;
};

const EMPTY_FILE_REFS: readonly AtPathRef[] = [];
const EMPTY_SKILLS: readonly EffectiveSkill[] = [];

/** `buildListRows()` 的行 → `AtPathRef`（过滤根目录；与现网 typeahead 候选同口径）。 */
function toAtPathRefs(
  rows: readonly {readonly path: string; readonly kind: string}[],
): readonly AtPathRef[] {
  const refs: AtPathRef[] = [];
  for (const row of rows) {
    if (row.path === '/') {
      continue;
    }
    refs.push({
      path: row.path,
      kind: row.kind === 'dir' ? ('dir' as const) : ('file' as const),
    });
  }
  return refs;
}

/** `AtPathRef[]` 逐项比对（内容不变则复用旧引用，纪律 C）。 */
function sameAtPathRefs(
  a: readonly AtPathRef[],
  b: readonly AtPathRef[],
): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]!.path !== b[i]!.path || a[i]!.kind !== b[i]!.kind) {
      return false;
    }
  }
  return true;
}

/**
 * `EffectiveSkill[]` 逐项比对 typeahead 消费到的字段（内容不变则复用旧引用）。
 *
 * 刻意不比 `JSON.stringify`（候选多时是 O(n·字段) 的字符串拼装）也不比引用
 * （`effectiveSkills()` 每次都造新对象，比引用等于永不相等，这条捷径直接失效）。
 * 取中：只比 web 侧 `skillTypeaheadItem` / `filterSkillTypeaheadCandidates`
 * 真正读的字段。
 */
function sameSkills(
  a: readonly EffectiveSkill[],
  b: readonly EffectiveSkill[],
): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]!;
    const right = b[i]!;
    if (
      left.name !== right.name ||
      left.valid !== right.valid ||
      left.effective !== right.effective ||
      left.disabled !== right.disabled ||
      left.domain !== right.domain ||
      left.overridden !== right.overridden ||
      left.description !== right.description ||
      left.invalidReason !== right.invalidReason
    ) {
      return false;
    }
  }
  return true;
}

export function useChatComposerController({
  scope,
  hasModel,
  running,
  onMessagesChanged,
  onNeedModel,
  canResumeWithoutInput,
  lastMessageIsPlainUserText,
  draftRestoreToken,
  onOpenComposerFullscreen,
  setComposerText,
}: UseChatComposerControllerOptions): ChatComposerController {
  const insets = useSafeAreaInsets();
  const runtime = useRuntime();
  const {sessionId} = scope;

  const initial = readChatComposerDraftState(sessionId);
  const [text, setText] = useState(initial.text);
  const [cursor, setCursor] = useState(0);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([
    ...initial.attachments,
  ]);
  const [error, setError] = useState<string | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  /** `@` typeahead 候选源（`AtPathRef[]`；非过滤结果，过滤在组件侧）。 */
  const [fileRefs, setFileRefs] =
    useState<readonly AtPathRef[]>(EMPTY_FILE_REFS);
  /** `$` 技能候选源（当前项目合并视图，不走会话工作区）。 */
  const [skillRows, setSkillRows] = useState<readonly EffectiveSkill[]>(
    EMPTY_SKILLS,
  );
  /** 文件批注 store 变更时 bump，驱动 hasAnnotateDrafts 重算。 */
  const [annotateEpoch, setAnnotateEpoch] = useState(0);
  /** 键盘态（纪律 B：只在布尔翻转时 setState）。 */
  const [keyboardUp, setKeyboardUp] = useState(false);

  const streamHandlersRef = useRef({onMessagesChanged});
  streamHandlersRef.current = {onMessagesChanged};

  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  /** text 的镜像 ref：命令式写入的回声去重（纪律 A，见 `onChangeText`）。 */
  const textRef = useRef(text);
  textRef.current = text;

  /** M7 命令式通道的最新引用（options 里那个可能被逐帧重建）。 */
  const setComposerTextRef = useRef(setComposerText);
  setComposerTextRef.current = setComposerText;

  const hasAnnotateDrafts = hasChatAnnotateDrafts(sessionId);
  void annotateEpoch;

  /* ------------------------------------------------------------------ *
   * 键盘态派生（纪律 B）
   * ------------------------------------------------------------------ */

  const {height: keyboardHeightSV} = useReanimatedKeyboardAnimation();
  useAnimatedReaction(
    () => -keyboardHeightSV.value > 0,
    (up, previous) => {
      // 首帧 previous 为 null：不做「初始态」上报，只在真实翻转时过桥。
      if (previous == null || up === previous) {
        return;
      }
      runOnJS(setKeyboardUp)(up);
    },
    [keyboardHeightSV],
  );

  /* ------------------------------------------------------------------ *
   * 候选源拉取（两个 effect；输出改 composerState.typeahead 的候选源）
   * ------------------------------------------------------------------ */

  useEffect(() => {
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
          const next = toAtPathRefs(rows);
          setFileRefs(prev => (sameAtPathRefs(prev, next) ? prev : next));
        }
      } catch {
        if (!cancelled) {
          setFileRefs(prev => (prev === EMPTY_FILE_REFS ? prev : EMPTY_FILE_REFS));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await runtimeRef.current
          .skills()
          .effectiveSkills(scope.projectId);
        if (!cancelled) {
          const next: readonly EffectiveSkill[] = list;
          setSkillRows(prev => (sameSkills(prev, next) ? prev : next));
        }
      } catch {
        if (!cancelled) {
          setSkillRows(prev => (prev === EMPTY_SKILLS ? prev : EMPTY_SKILLS));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope.projectId]);

  const typeahead = useMemo<ConversationTypeaheadSource>(() => {
    if (fileRefs.length === 0 && skillRows.length === 0) {
      return EMPTY_CONVERSATION_TYPEAHEAD_SOURCE;
    }
    return {files: fileRefs, skills: skillRows};
  }, [fileRefs, skillRows]);

  /* ------------------------------------------------------------------ *
   * 草稿链
   * ------------------------------------------------------------------ */

  const persistDraft = useCallback(
    (nextText: string, nextAttachments: readonly MessageAttachment[]) => {
      writeChatComposerDraftState(
        sessionId,
        {text: nextText, attachments: nextAttachments},
        runtimeRef.current.sessions,
      );
    },
    [sessionId],
  );

  /**
   * 草稿重读进本地 state（水化链与 `subscribeChatComposerDraft` 共用一条路径）。
   *
   * 文本真变时同步经命令式通道下发（D8：水化不等转录 webview 的 ready 握手，
   * 两链并行；见 `commitComposerText` 与 options.setComposerText 注释）。只在
   * 文本变化时下发——状态条整表替换（`applyComposerStatusAttachmentsReplace`）
   * 也会广播到这里，文本未变就重写输入框是无谓的 `setValue`，还会打断 IME
   * 组合态。
   */
  const syncFromDraft = useCallback(() => {
    const draft = readChatComposerDraftState(sessionId);
    const textChanged = draft.text !== textRef.current;
    setText(draft.text);
    textRef.current = draft.text;
    setAttachments([...draft.attachments]);
    if (textChanged) {
      setComposerTextRef.current?.(draft.text);
    }
  }, [sessionId]);

  /**
   * 整段写入（Picker 路径的唯一入口）。
   *
   * 三件事一起做：本地 state 立即落位（供 `composerState` 派生与后续插入算光标）、
   * 草稿落库、**命令式通道下发**（M7，落点 `NativeChatComposer` 的 `ref.setText`）。
   * 本地先落位而不是等组件回声：命令式通道在输入组件未挂载时静默返回（ref 为
   * null），那时若只靠回声同步，本地 state 会停在旧值，下一次插入就算错光标了
   * （挂载后的 value effect 会兜底补写，见组件侧注释）。
   */
  const commitComposerText = useCallback(
    (next: string, nextCursor?: number) => {
      setText(next);
      textRef.current = next;
      if (nextCursor != null) {
        setCursor(nextCursor);
      }
      persistDraft(next, statusOnlyComposerAttachments(attachments));
      setComposerTextRef.current?.(next, nextCursor);
    },
    [attachments, persistDraft],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rt = runtimeRef.current;
      try {
        await hydrateChatComposerDraftFromDb(sessionId, rt.sessions);
      } catch {
        // 草稿水化失败：沿用内存缓存里的初值，不阻断 dock 渲染
        return;
      }
      if (cancelled) {
        return;
      }
      try {
        const status = await projectComposerStatusForSession(rt, sessionId);
        if (cancelled) {
          return;
        }
        applyComposerStatusAttachmentsReplace({sessionId, attachments: status});
      } catch {
        // 投影失败时仍用已水化的 attach+text
      }
      if (cancelled) {
        return;
      }
      syncFromDraft();
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, draftRestoreToken, syncFromDraft]);

  useEffect(() => {
    return subscribeChatComposerDraft(changedSessionId => {
      if (changedSessionId !== sessionId) {
        return;
      }
      syncFromDraft();
    });
  }, [sessionId, syncFromDraft]);

  useEffect(() => {
    return subscribeChatAnnotateDraft(changedSessionId => {
      if (changedSessionId !== sessionId) {
        return;
      }
      refreshComposerAnnotateChips(sessionId);
      setAnnotateEpoch(n => n + 1);
    });
  }, [sessionId]);

  /* ------------------------------------------------------------------ *
   * web 上行消费
   * ------------------------------------------------------------------ */

  /**
   * 纪律 A：`change` 的唯一消费口，**不区分来源**。
   *
   * 同值回声（命令式写入后宿主回调的 `onComposerChangeText`）直接早退：那次写入
   * 已经由 `commitComposerText` 落过库，再落一遍只是重复写同一份。
   */
  const onChangeText = useCallback(
    (next: string) => {
      if (next === textRef.current) {
        return;
      }
      textRef.current = next;
      setText(next);
      persistDraft(next, statusOnlyComposerAttachments(attachments));
    },
    [attachments, persistDraft],
  );

  const onSelectionChange = useCallback(
    (selection: ComposerInputSelection) => {
      setCursor(selection.start);
    },
    [],
  );

  /* ------------------------------------------------------------------ *
   * 发送决策
   * ------------------------------------------------------------------ */

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
        textRef.current = '';
        setAttachments([]);
        // 清空同样走 M7 命令式通道：本地 state 归零之外显式把输入框清掉，
        // 不依赖 value effect 的下一轮回程。
        setComposerTextRef.current?.('', 0);
      };

      try {
        const stream = await runtime.preferences.getLlmStreamEnabled();
        timingLog('pref-read done');
        const annotateDrafts = listChatAnnotateDrafts(sessionId);
        // 门禁由 manager 的 per-session 单元拒绝（返回明确错误），run 本体
        // fire-and-forget；refcount 与收尾归 manager。
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
            // 空续跑等路径可能不走 append 回调——结束后兜底清草稿
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
    [runtime, scope, sessionId, hasAnnotateDrafts],
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

  const terminate = useCallback(() => {
    // 经 manager 的 abort 语义（retain/freeze 时序由 core 负责；收尾照常走事件路径）。
    runtime.sessionStreamUnitManager.stopRun(sessionId);
  }, [runtime, sessionId]);

  /** 发送三分支（现网 `ChatComposer.tsx:500-538` 逐字保留）。 */
  const send = useCallback(async () => {
    // t0 钉在入口第一行：executeRun 之前的一切排队/前置都在表内
    resetRunTiming();
    if (!hasModel) {
      onNeedModel();
      return;
    }

    if (running) {
      // 双保险保留：web 侧 running 时发的是 `terminate`，但发送键与宿主状态之间
      // 存在一帧窗口，仍按「发送」进来的应当落到停止。
      terminate();
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
    // 依赖刻意只留真正在体内读的：`canResumeWithoutInput` 已经由 `sendIntent`
    // 带进来了（再列一遍等于把「可空发续跑」这条派生值拆成两个真源），
    // `runtime` / `sessionId` 只经 `executeRun` / `terminate` 间接用到。
  }, [
    hasModel,
    running,
    text,
    lastMessageIsPlainUserText,
    onNeedModel,
    executeRun,
    sendIntent,
    terminate,
  ]);

  const needModel = useCallback(() => {
    onNeedModel();
  }, [onNeedModel]);

  const openFullscreen = useCallback(() => {
    onOpenComposerFullscreen?.({text});
  }, [onOpenComposerFullscreen, text]);

  const handleDockAction = useCallback(
    (action: ConversationDockAction) => {
      switch (action) {
        case 'send':
          void send();
          return;
        case 'terminate':
          terminate();
          return;
        case 'needModel':
          needModel();
          return;
        case 'fullscreen':
          openFullscreen();
          return;
        case 'atPicker':
          setPickerOpen(true);
          return;
        case 'skillPicker':
          setSkillPickerOpen(true);
          return;
        default:
          return;
      }
    },
    [send, terminate, needModel, openFullscreen],
  );

  /* ------------------------------------------------------------------ *
   * Picker 路径 token 插入
   * ------------------------------------------------------------------ */

  /**
   * 有未完成的 `@…` / `$…` 时从触发符起替换到光标，避免残留半截查询。
   *
   * 注意这里仍然要算一次 `findActiveAtQuery`（纯函数，插入那一刻才算）：typeahead
   * 的**开合**归 `NativeChatComposer` 组件自治（computeTypeaheadView 内部算），
   * 但**插入落点**仍在 RN 侧算——controller 只有 text 与 cursor 两份数据。去掉
   * 这一步会让「`@半截` → 点选候选」在光标后留下残渣。
   */
  const insertTokensIntoComposer = useCallback(
    (pathTokens: readonly string[]) => {
      if (pathTokens.length === 0) {
        return;
      }
      const current = textRef.current;
      const activeAt = findActiveAtQuery(current, cursor);
      const replaceStart = activeAt != null ? activeAt.start : cursor;
      const next = buildTokenInsertion(
        current,
        cursor,
        replaceStart,
        pathTokens,
      );
      commitComposerText(next.text, next.cursor);
    },
    [cursor, commitComposerText],
  );

  const insertSkillToken = useCallback(
    (skillName: string) => {
      const current = textRef.current;
      const token = `$${skillName}`;
      const activeSkill = findActiveAtQuery(current, cursor, '$');
      const replaceStart = activeSkill != null ? activeSkill.start : cursor;
      const next = buildTokenInsertion(
        current,
        cursor,
        replaceStart,
        token,
      );
      commitComposerText(next.text, next.cursor);
    },
    [cursor, commitComposerText],
  );

  const closeAtPicker = useCallback(() => {
    setPickerOpen(false);
  }, []);

  const closeSkillPicker = useCallback(() => {
    setSkillPickerOpen(false);
  }, []);

  const onAtPickerConfirm = useCallback(
    (pathTokens: readonly string[]) => {
      insertTokensIntoComposer(pathTokens);
    },
    [insertTokensIntoComposer],
  );

  const onSkillPickerConfirm = useCallback(
    (skillName: string) => {
      insertSkillToken(skillName);
    },
    [insertSkillToken],
  );

  /* ------------------------------------------------------------------ *
   * 派生与组装（spec §composerState 字段表）
   * ------------------------------------------------------------------ */

  const inputDisabled = !hasModel || running || lastMessageIsPlainUserText;
  const sendDisabled = sendIntent.sendDisabled;
  const placeholder = hasModel ? '输入消息…' : '选择模型后可发送';

  const composerState = useMemo<ConversationComposerState>(
    () => ({
      inputDisabled,
      // hasModel 单独携带：hintRow 显隐判据是 `!hasModel`——`inputDisabled` 是它的
      // 超集，运行态 / 末条纯文本态下用后者会误显「请先选择工作区模型」。
      hasModel,
      sendDisabled,
      running,
      ...(error != null && error !== '' ? {error} : {}),
      fullscreenEnabled: onOpenComposerFullscreen != null,
      placeholder,
      chips: attachments,
      keyboardUp,
      typeahead,
    }),
    [
      inputDisabled,
      hasModel,
      sendDisabled,
      running,
      error,
      onOpenComposerFullscreen,
      placeholder,
      attachments,
      keyboardUp,
      typeahead,
    ],
  );

  return {
    composerState,
    text,
    cursor,
    onChangeText,
    onSelectionChange,
    handleDockAction,
    send,
    terminate,
    needModel,
    openFullscreen,
    pickerOpen,
    skillPickerOpen,
    closeAtPicker,
    closeSkillPicker,
    onAtPickerConfirm,
    onSkillPickerConfirm,
    insertTokensIntoComposer,
    insertSkillToken,
    safeAreaBottom: insets.bottom,
  };
}
