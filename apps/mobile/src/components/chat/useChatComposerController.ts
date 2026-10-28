/**
 * Composer 逻辑层（chat-webview-unify Step 7 拆出；composer-native-2026-10
 * Step 5 数据来源换向）—— **RN 侧 dock 域的一切真源**。
 *
 * ## 为什么要拆
 * dock 全区（chips / input / toolbar）由 `NativeChatComposer`
 * 承接（原 Step 3/4 期间曾进 chat-conversation 文档，输入框原生化后回到 RN）。
 * 留在本 hook 的职责：
 * 1. **发送决策**（`executeRun` / `send` 三分支 / `resolveComposerSendIntent`）；
 * 2. **草稿三订阅链**（水化 / `subscribeChatComposerDraft` / `chatAnnotateDraftStore.subscribe`）；
 * 另有 **Picker 状态机**（`pickerOpen` / `skillPickerOpen` 与 confirm 回调）
 * 与 **token 插入 / 胶囊区间维护链**（`insertSkillToken` / `insertTokensIntoComposer` 一族）。
 *
 * 这两样算完的产物组装成 `composerState` 供面板**直连** `NativeChatComposer`
 * 的 props（组件不做业务推导），另加键盘态 `keyboardUp` 与 `safeAreaBottom`。
 * 数据来源在 Step 5 换向（spec 变更点 #6）：打字/选区/dock 上行不再走桥
 * （`ChatConversationWebView` 已退为纯转录宿主），改为组件事件直连；命令式写入
 * 走组件 `ref.setText`（M7）。回调签名（onChangeText / onSelectionChange /
 * handleDockAction）保持不变——只是调用方从桥上行换成了组件 props。
 *
 * ## 两条纪律
 *
 * **(A) 打字真源在输入组件内部，`change` 只上抛不回写**（M6）。`onChangeText` 是
 * 唯一消费口：每键上行一条，落库即走。粘贴这类 **组件自治写入**
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
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAnimatedReaction, runOnJS} from 'react-native-reanimated';
import {useReanimatedKeyboardAnimation} from 'react-native-keyboard-controller';
import {
  chatAnnotateDraftStore,
  composerSendPolicy,
  attachmentScanner,
  type MessageAttachment,
} from '@novel-master/core/chat';
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
import {composerAtPath} from './composer-at-path';
import {
  buildTokenInsertion,
  queryWithinConfirmedRange,
  statusOnlyComposerAttachments,
} from './composer-token-insert';
import {scanComposerTokenRangesForSend} from './composer-send-scan';
import {isValidTokenRangeText} from './composer-highlight';
import {
  remapTokenRanges,
  scanTokensToRanges,
  type TokenRange,
} from './native-composer/token-ranges';
import type {ComposerInputSelection} from './ComposerInputBridge';
import type {ConversationDockAction} from './ChatConversationBridge';

/**
 * 持久化区间逐条过形态校验，丢弃不合法的（旧格式 `$name`、越界、半截）。
 * 全合法时原引用返回（保持 marker 稳定），有丢弃才换新数组。
 */
function filterValidTokenRanges(
  plain: string,
  ranges: readonly TokenRange[],
): readonly TokenRange[] {
  const kept = ranges.filter(range => isValidTokenRangeText(plain, range));
  return kept.length === ranges.length ? ranges : kept;
}

/**
 * dock 全字段状态（composer-native-2026-10 Step 6 自 `ChatConversationBridge`
 * 迁入：本 hook 是它的唯一消费方——组装后面板按字段拆开直连
 * `NativeChatComposer` 的 props，不再经桥收发）。
 */
type ConversationComposerState = {
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
};
import {resetRunTiming, timingLog} from '@/debug/run-timing';

/** ⛶ 全屏编辑入口载荷：当前输入文本原样带给父层（父层负责导航与保存回填）。 */
export type ComposerFullscreenPayload = {text: string};

type UseChatComposerControllerOptions = {
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
   *
   * **第三参 `ranges`（D1/D4 接口）**：水化链携带持久化确认区间下发，
   * 组件侧跳 remap 直写基线（见 `NativeChatComposer.commitExternalText`）。
   * 漏改中间跳时 TypeScript 少参兼容会静默丢第三参，面板回调
   * （`ChatConversationPanel.setComposerText`）与组件接口必须同步三参。
   */
  readonly setComposerText?: (
    text: string,
    cursor?: number,
    ranges?: readonly TokenRange[],
  ) => void;
};

type ChatComposerController = {
  /**
   * dock 域聚合状态：面板按字段拆开直连 `NativeChatComposer` 的 props
   * （类型载体仍是 `ConversationComposerState`，不再经桥收发）。
   */
  readonly composerState: ConversationComposerState;
  /** 输入框当前全文（外部真源草稿文本；**打字真源在输入组件内部编辑器态**）。 */
  readonly text: string;
  /**
   * 胶囊确认区间（2026-10-07 真机轮拍板：胶囊只允许引用得到，手输不成胶囊）。
   * 引用落文（选择器插入）时登记，水化时正则全扫一次性引导，
   * 其后一切文本编辑经差分重映射维护——传给 `NativeChatComposer` 的
   * `tokenRanges` prop，下发 `setTokenRanges` 渲染胶囊。
   */
  readonly tokenRanges: readonly TokenRange[];
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
   * Picker 确认落文（`onAtPickerConfirm` / `onSkillPickerConfirm` 消费）：
   * 两者都收**裸** token（`@path` / 技能名），终止符由本方法补——`@` 侧补尾 `@`
   * 成 `@path@`，`$` 侧包成 `$技能名$`。落文走 `commitComposerText`
   * （M7 命令式通道），并替换活跃的半截查询。
   */
  readonly insertTokensIntoComposer: (pathTokens: readonly string[]) => void;
  readonly insertSkillToken: (skillName: string) => void;

  /** 安全区底部高度（`init.composer.safeAreaBottom` 的取值）。 */
  readonly safeAreaBottom: number;
};

/**
 * 区间内容比较（长度 + 逐元素 start/end）。
 *
 * `syncFromDraft` 的 ranges 更新判据**不能**挂在 `textChanged` 上：切会话时
 * 两个会话可能持有同一份文本但不同的确认状态（A 会话是确认胶囊、B 会话是
 * 同串手输），只按文本判断会让 B 继承 A 的区间（串台）。按内容比较而不是按
 * 数组引用比较：每次水化都重建数组，引用恒不相等会让每个广播都刷一次 state。
 */
function tokenRangesEqual(
  a: readonly TokenRange[],
  b: readonly TokenRange[],
): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index]!;
    const right = b[index]!;
    if (left.start !== right.start || left.end !== right.end) {
      return false;
    }
  }
  return true;
}

/**
 * nm-style: keep-public — React hook 边界：面板只调用一次，但承载整块输入/发送状态机，不可内联。
 */
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
  /**
   * 胶囊确认区间（语义见 `ChatComposerController.tokenRanges`）。
   *
   * **D1 持久化优先**：草稿带 `tokenRanges` → 直接使用（`[]` 也算有值，表示
   * 确认无胶囊）；只有 `undefined`（旧草稿 / 带外写入）才做一次正则全扫兜底，
   * 兜底结果由 `syncFromDraft` 写回固化。历史上的「水化全扫」在此退役——
   * 那会把尾追内容重新吞进胶囊、把半截手输升格。
   */
  const [tokenRanges, setTokenRanges] = useState<readonly TokenRange[]>(() =>
    initial.tokenRanges != null
      ? filterValidTokenRanges(initial.text, initial.tokenRanges)
      : scanTokensToRanges(initial.text),
  );
  const [cursor, setCursor] = useState(0);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([
    ...initial.attachments,
  ]);
  const [error, setError] = useState<string | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
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
  /** tokenRanges 的镜像 ref：打字/写入回调内即时重映射，不等 React 提交。 */
  const tokenRangesRef = useRef(tokenRanges);
  tokenRangesRef.current = tokenRanges;
  /**
   * 编辑前选区右缘镜像（D11 删除锚，与组件侧 `selectionRef` 同款）。
   *
   * `onSelectionChange` 逐次推进；打字 `change` 事件到达时原生**先发文本变更、
   * 后发选区回调**，所以 `onChangeText` 里读到的还是变更前的值——remap 删除锚
   * 据此反推真实删除段（相邻胶囊删左颗时不被公共前后缀咬进幸存胶囊）。
   * null = 从未收到选区事件，删除锚回退差分口径（只增强不回退）。
   * 命令式写入落位后同步镜像，下一次打字读到的就是刚落下的光标。
   */
  const prevCursorRef = useRef<number | null>(null);

  /**
   * 确认区间的统一推进口：差分重映射旧区间（编辑区与胶囊重叠即摘除、贴边
   * 插入不并入），可选拼接新登记区间（引用落文）。所有文本变更咽喉点都走
   * 这里，保证 state 与 ref 同拍一致。
   */
  const advanceTokenRanges = useCallback(
    (
      prev: string,
      next: string,
      inserted?: readonly TokenRange[],
      nextCursor?: number,
      prevCursor?: number,
    ) => {
      const remapped = remapTokenRanges(
        prev,
        next,
        tokenRangesRef.current,
        nextCursor,
        // D11 删除锚：编辑前光标（打字路径由选区镜像带入；Picker 落文不带，
        // 走既有纯插入/差分口径）。
        prevCursor,
      );
      const merged =
        inserted != null && inserted.length > 0
          ? [...remapped, ...inserted].sort((a, b) => a.start - b.start)
          : remapped;
      tokenRangesRef.current = merged;
      setTokenRanges(merged);
    },
    [],
  );

  /** M7 命令式通道的最新引用（options 里那个可能被逐帧重建）。 */
  const setComposerTextRef = useRef(setComposerText);
  setComposerTextRef.current = setComposerText;

  const hasAnnotateDrafts = chatAnnotateDraftStore.has(sessionId);
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
   * 草稿链
   * ------------------------------------------------------------------ */

  const persistDraft = useCallback(
    (nextText: string, nextAttachments: readonly MessageAttachment[]) => {
      writeChatComposerDraftState(
        sessionId,
        {
          text: nextText,
          attachments: nextAttachments,
          // D1 落库咽喉点：带上当前确认区间（含 `[]` = 确认无胶囊）。
          tokenRanges: tokenRangesRef.current,
        },
        runtimeRef.current.sessions,
      );
    },
    [sessionId],
  );

  /**
   * 草稿重读进本地 state（水化链与 `subscribeChatComposerDraft` 共用一条路径）。
   *
   * 文本真变或确认区间真变时同步经命令式通道下发（D8：水化不等转录 webview
   * 的 ready 握手，两链并行；见 `commitComposerText` 与 options.setComposerText
   * 注释）。ranges 变化也要下发：同文本不同确认状态的会话切换（A 确认胶囊 /
   * B 同串手输）只改区间不改文本，漏发会让输入框渲染上一会话的胶囊。
   * 状态条整表替换（`applyComposerStatusAttachmentsReplace`）也广播到这里，
   * 文本与区间都未变就重写输入框是无谓的 `setValue`，还会打断 IME 组合态。
   *
   * **D4 三跳**：第三参携带的必须与 `setTokenRanges` 的 state 是**同一份数组**
   * （`nextRanges`）——组件侧对第三参跳 remap 直写，prop 收敛 effect 再按内容
   * 相等短路，不会用旧 state 覆盖。
   */
  const syncFromDraft = useCallback(() => {
    const draft = readChatComposerDraftState(sessionId);
    const textChanged = draft.text !== textRef.current;
    setText(draft.text);
    textRef.current = draft.text;
    setAttachments([...draft.attachments]);
    // D1 持久化优先：草稿带 `tokenRanges`（含 `[]`）直接采用；仅 `undefined`
    // （旧草稿 / 全屏回填未给值 / undo_send 恢复）才做一次正则兜底扫描。
    // ranges 的更新按**内容**比较而非挂在 textChanged 上——同文本不同会话
    // 切换时（A 确认胶囊 / B 手输同串）才不会串台。
    const draftRanges = draft.tokenRanges;
    // 水化自愈：持久化区间逐条过形态校验（首尾同字符触发符且整段恰好一颗 token）。
    // 旧格式 / 越界 / 半截区间一律丢弃——否则会把尾随文字整段画成大胶囊；过滤结果写回草稿。
    const nextRanges =
      draftRanges != null
        ? filterValidTokenRanges(draft.text, draftRanges)
        : scanTokensToRanges(draft.text);
    const rangesChanged = !tokenRangesEqual(nextRanges, tokenRangesRef.current);
    if (rangesChanged) {
      tokenRangesRef.current = nextRanges;
      setTokenRanges(nextRanges);
    }
    if (textChanged || rangesChanged) {
      // D4 第三参：水化链把持久化确认区间直接交给组件（跳 remap 直写）。
      setComposerTextRef.current?.(draft.text, undefined, nextRanges);
      // D11 水化对称（P3-2）：组件侧 `commitExternalText` 在水化下发时会把
      // 原生选区落到文本尾（cursor 缺省 = plain.length），controller 侧的
      // 「编辑前光标」必须同拍对齐——否则上一个会话残留的旧选区会让下一次
      // 删除的删除锚指错位置。只在真正下发时推进：text/ranges 都未变的
      // 状态条广播不重写输入框，也不该动光标快照。
      prevCursorRef.current = draft.text.length;
    }
    const rangesDropped =
      draftRanges != null && nextRanges.length !== draftRanges.length;
    if ((draftRanges === undefined || rangesDropped) && draft.text !== '') {
      // 兜底扫描结果 / 自愈过滤结果写回固化（仅此一次）：text 与 ranges 均空（空会话）跳过，
      // 避免每次水化写一次 null 的无害写放大。persistDraft 读的是刚推进过的
      // tokenRangesRef，落库即固化本次扫描值。
      persistDraft(draft.text, draft.attachments);
    }
  }, [sessionId, persistDraft]);

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
    (next: string, nextCursor?: number, insertedRanges?: readonly TokenRange[]) => {
      advanceTokenRanges(textRef.current, next, insertedRanges, nextCursor);
      setText(next);
      textRef.current = next;
      if (nextCursor != null) {
        setCursor(nextCursor);
        // 命令式写入的落位同步进编辑前光标镜像（D11）：下一次打字事件读到的
        // 「编辑前光标」就是这里落下的位置，不能沿用上一次打字的旧选区。
        prevCursorRef.current = nextCursor;
      }
      persistDraft(next, statusOnlyComposerAttachments(attachments));
      setComposerTextRef.current?.(next, nextCursor);
    },
    [attachments, persistDraft, advanceTokenRanges],
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
    return chatAnnotateDraftStore.subscribe(changedSessionId => {
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
      // D11 删除锚：编辑前选区右缘（原生先发文本变更、后发选区回调，此刻
      // ref 里还是变更前的值）。整段选区删除时右缘贴着删除段右端，退格时
      // 就是光标位——两种形态都能反推出真实的删除段。
      advanceTokenRanges(
        textRef.current,
        next,
        undefined,
        undefined,
        prevCursorRef.current ?? undefined,
      );
      textRef.current = next;
      setText(next);
      persistDraft(next, statusOnlyComposerAttachments(attachments));
    },
    [attachments, persistDraft, advanceTokenRanges],
  );

  const onSelectionChange = useCallback(
    (selection: ComposerInputSelection) => {
      // 选区右缘是删除锚的「编辑前光标」（D11）：选区删除后光标落在起点，
      // 用右缘才能把整段选区反推成删除段。
      prevCursorRef.current = selection.end;
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

      // D9 掩码二段式（发送侧）：区间下标相对**未 trim** 的草稿原文（发送正文
      // 沿用历史口径 `content = text.trim()`）。先按区间 slice 单独扫描得到
      // rangeResults，再把同一批区间换算到正文坐标交给 core 掩码全量扫描；
      // 区间为空（旧草稿 / 手输无胶囊）时走下方的全量扫描直出（不掩码）。
      const sendScan = scanComposerTokenRangesForSend(
        textRef.current,
        content,
        tokenRangesRef.current,
      );
      // D9 ③ 无区间草稿（T-CA9 ③ 端到端）：不走掩码二段式，直接全量扫描
      // trim 后正文（与 core 的 scanText 同一份）产出 attachments，随 run
      // 下传占 existing 位。core 随后仍会全量扫描一次，但去重键相同的条目
      // 保留 existing——最终结果与 core 自行扫描逐项一致（手输 `$技能` /
      // `@路径` 照常挂载、贴字 `$` 维持不识别），发送行为零变化，只是让
      // 「与现状一致」可以在本链路端到端断言。
      const sendAttachments =
        tokenRangesRef.current.length > 0
          ? sendScan.attachments
          : [
              ...attachmentScanner.scanAtPaths(content),
              ...attachmentScanner.scanSkills(content),
            ];

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
        tokenRangesRef.current = [];
        setTokenRanges([]);
        setAttachments([]);
        // 清空同样走 M7 命令式通道：本地 state 归零之外显式把输入框清掉，
        // 不依赖 value effect 的下一轮回程。
        setComposerTextRef.current?.('', 0);
      };

      try {
        const stream = await runtime.preferences.getLlmStreamEnabled();
        timingLog('pref-read done');
        const annotateDrafts = chatAnnotateDraftStore.list(sessionId);
        // 门禁由 manager 的 per-session 单元拒绝（返回明确错误），run 本体
        // fire-and-forget；refcount 与收尾归 manager。
        const manager = runtime.sessionStreamUnitManager;
        if (manager == null) {
          throw new Error('运行时尚未就绪，请稍后重试');
        }
        const started = manager.startRun(sessionId, scope.projectId, content, {
          stream,
          allowResumeWithoutInput,
          // D9：区间扫描结果随 run 下传，core 以 existing 位合并（区间结果
          // 优先于掩码后的全量扫描）；excludedScanRanges 让 core 的全量扫描
          // 看不到胶囊内触发符（`@path@$技能$` 不再污染路径、`$A$$B$` 不重复挂载）。
          // 空数组不传：undefined 与 `[]` 在 core 侧行为等价，不传更贴近旧调用形态。
          attachments:
            sendAttachments.length > 0 ? sendAttachments : undefined,
          excludedScanRanges:
            sendScan.excludedScanRanges.length > 0
              ? sendScan.excludedScanRanges
              : undefined,
          annotateDrafts:
            annotateDrafts.length > 0 ? annotateDrafts : undefined,
          onUserMessageAppended: () => {
            // append 成功后再清输入 + 批注，避免失败时丢草稿
            chatAnnotateDraftStore.clear(sessionId);
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
      composerSendPolicy.evaluate({
        text,
        canResumeWithoutInput,
        hasAnnotateDrafts,
        hasModel,
        running,
      }),
    [
      text,
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
   * 有未完成的 `@…` / `$…` 时从触发符起替换到光标，避免残留半截查询
   * （Picker 的「半截查询替换」语义）。插入那一刻现算一次
   * `findActiveAtQuery`（纯函数）——controller 只有 text 与 cursor 两份数据，
   * 去掉这一步会让「`@半截` → Picker 确认」在光标后留下残渣。
   *
   * 确认区间守卫（共享纯函数 `queryWithinConfirmedRange`，见
   * composer-token-insert）排除「整段落进已确认胶囊」的假查询：chip 零空格
   * 插入后光标贴 token 右缘，不守的话第二次确认会把上一颗整颗替换。
   */
  const insertTokensIntoComposer = useCallback(
    (pathTokens: readonly string[]) => {
      if (pathTokens.length === 0) {
        return;
      }
      // picker 交上来的是裸 `@path`（picker 被 VfsMoveDirPicker 复用做目录移动，
      // 不能自带终止符）：尾 `@` 统一在这里补，与 `insertSkillToken` 的 `$…$` 对称。
      const tokens = pathTokens.map(token => `${token}@`);
      const current = textRef.current;
      const activeAt = composerAtPath.detectQuery(current, cursor);
      const replaceStart =
        activeAt != null &&
        !queryWithinConfirmedRange(
          tokenRangesRef.current,
          activeAt.start,
          cursor,
        )
          ? activeAt.start
          : cursor;
      const next = buildTokenInsertion(
        current,
        cursor,
        replaceStart,
        tokens,
      );
      commitComposerText(next.text, next.cursor, next.tokenRanges);
    },
    [cursor, commitComposerText],
  );

  const insertSkillToken = useCallback(
    (skillName: string) => {
      const current = textRef.current;
      // 明文带终止符：`$技能名$`，与 composer 高亮/发送扫描的 bounded 口径一致
      const token = `$${skillName}$`;
      const activeSkill = composerAtPath.detectQuery(current, cursor, '$');
      const replaceStart =
        activeSkill != null &&
        !queryWithinConfirmedRange(
          tokenRangesRef.current,
          activeSkill.start,
          cursor,
        )
          ? activeSkill.start
          : cursor;
      const next = buildTokenInsertion(
        current,
        cursor,
        replaceStart,
        token,
      );
      commitComposerText(next.text, next.cursor, next.tokenRanges);
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
    ],
  );

  return {
    composerState,
    text,
    tokenRanges,
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
