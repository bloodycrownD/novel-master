/**
 * 原生输入 dock（composer-native-2026-10 · spec 变更点 #3：Step 3 输入本体 +
 * Step 4 外围件，对外一个组件）。
 *
 * 以 `EnrichedMarkdownTextInput` 为核心的受控组件：token 语义保持正则扫描为真源
 * （D1），库只承担「可样式化的原生 TextInput」角色——它的 mention 生命周期事件
 * 不启用（其默认 indicators 为空集，天然不启动）。
 *
 * ## dock 纵向结构（K 组，对齐 web `#composer-dock` 的 DOM 形态）
 *
 * `[hintRow] → [error] → box（[chips 行] → [输入区（含 typeahead 浮层锚定）] →
 * [toolbar 行]）`。box 是输入区的单一视觉容器（横向接缝不切开它）；dock 底
 * padding = `keyboardUp ? 0 : max(8, safeAreaBottom)`（`resolveDockBottomPadding`，
 * web `DOCK_PADDING_BASE` 语义照搬）。
 *
 * ## 三条语义（D8：桥消失后 M 防线收敛到本组件内部）
 *
 * **M1 · change 先推进基线**：`onChangeText` 第一行先写 `baselineRef`，再做任何
 * 派生/上抛——后续读到旧基线的分支（value effect 的同值判断）才不会拿变化前
 * 的值做决定。
 *
 * **M6 · 打字真源**：打字路径只推进基线 + 上抛明文 + 下发 token ranges，
 * **绝不回写 `setValue`**——回写会把光标拽走并打断 IME 组合态（库的
 * `setValueFromJS` 会 `setText` 整个编辑器）。文本真源 = 库内部编辑器态，
 * RN 侧只持「最后已知明文」镜像。
 *
 * **M7 · 命令式通道**：外部写入（Picker 插入 / typeahead 点选 / 草稿水化 /
 * 发送清空 / undo 回滚 / **粘贴上屏**）一律走 `ref.setText(text, cursor?)`：
 * 推进基线 → 扫描 token 合成 markdown → `setValue` → 下发 `setTokenRanges` →
 * 可选光标落位 → **主动补发一次 `onComposerChangeText`**。补发的理由：库在
 * `setValueFromJS` 期间处于 `EditPhase.Importing`、事件被抑制，`onChangeText`
 * 不会自发回声；web 侧 dock 的 `commitComposerText` 同样是写入后补发 change
 * （E10/F6 语义），controller 的同值回声去重保证补发幂等。
 *
 * value prop 的职责边界：它是外部明文真源的**镜像**（供父层声明式渲染与
 * effect 兜底），不是逐键回写的受控值。effect 只在 `value !== 基线` 时介入
 * ——即「外部改了 state 但没经本组件通道」的场景（水化 / 清空 / undo），
 * 走与 M7 完全相同的 `commitExternalText` 内部通道；打字与命令式写入的
 * 回声因基线已推进而不触发，M6 就是这样保住的。
 *
 * ## typeahead 浮层（E 组）与文本/光标镜像
 *
 * 候选计算纯函数化（`native-composer/typeahead-view.ts`，web 版逐字迁移）：
 * 触发判定复用 core 的 `findActiveAtQuery`、过滤复用两个 filter、上限 5。
 * 计算吃**组件内部的文本/光标镜像 state**（不是 value prop）——打字路径里
 * 镜像与基线在同一个 handler 内更新，浮层不需要等父层回程的 value prop 就能
 * 当帧重算；镜像只是 typeahead 的私有输入，不参与文本真源（真源仍只有
 * `baselineRef` 一份）。不渲染判据照 E5：无活跃 token / 候选空 / inputDisabled。
 *
 * 浮层是 RN absolute View，简化锚定在**输入区上缘整体浮起**（bottom: 100%）；
 * `onCaretRectChange` 的光标 rect 与输入区 onLayout 已收进 ref，精确到行的
 * 锚定接口留给真机 QA 后再接（TODO）。
 *
 * ## 粘贴门控（D9 / F 组）
 *
 * 库无 onPaste 拦截：`selectionMenuConfig` 关掉选区菜单里库自带的 Format /
 * Copy-as-Markdown 两项，`contextMenuItems` 提供自定义「粘贴」项回调 RN——
 * `uiRunning` / `inputDisabled` 两道闸拒绝时**不读剪贴板不上屏**，通过后
 * `Clipboard.getString` → `COMPOSER_PASTE_MAX_CHARS` 截断 → 光标处替换选区 →
 * 命令式 setText 通道落文并补发 change（F5/F6）。
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {LayoutChangeEvent, TextStyle} from 'react-native';
import {Pressable, ScrollView, Text, View} from 'react-native';
import Svg, {Path, Rect} from 'react-native-svg';
import Clipboard from '@react-native-clipboard/clipboard';
import {EnrichedMarkdownTextInput} from 'react-native-enriched-markdown';
import type {
  CaretRect,
  ContextMenuItem,
  EnrichedMarkdownTextInputInstance,
  InputSelectionMenuConfig,
  MarkdownTextInputStyle,
} from 'react-native-enriched-markdown';
import type {
  ConversationDockAction,
  ConversationTheme,
  ConversationTypeaheadSource,
} from './ChatConversationBridge';
import {EMPTY_CONVERSATION_TYPEAHEAD_SOURCE} from './ChatConversationBridge';
import {
  attachmentDraftChipsStyles,
  composerDockStyles,
  composerInputMetrics,
  composerTokenCapsule,
  composerToolBtnStyle,
  composerTypeaheadStyles,
  resolveDockBottomPadding,
} from './native-composer/dock-style';
import {resolveSendButtonState} from './native-composer/send-button';
import {
  computeTypeaheadView,
  typeaheadRenderKey,
  type TypeaheadItem,
} from './native-composer/typeahead-view';
import {
  scanTokensToRanges,
  synthesizeTokenMarkdown,
} from './native-composer/token-ranges';

/**
 * 高度上报死区：变化不超过该值不上抛（防亚像素抖动刷消息）。
 * 数值与 web 侧 `src/web/composer-input/webview/runtime/editor.ts` 的
 * `HEIGHT_EPSILON` 同口径（0.5）。
 */
export const COMPOSER_HEIGHT_EPSILON = 0.5;

/** 有模型时的占位文案（与 web dock / controller 的 placeholder 派生同文案）。 */
export const COMPOSER_PLACEHOLDER_WITH_MODEL = '输入消息…';
/** 无模型时的占位文案。 */
export const COMPOSER_PLACEHOLDER_WITHOUT_MODEL = '选择模型后可发送';

/**
 * 粘贴截断上限（D9：与旧链 `ChatConversationWebView` 的
 * `COMPOSER_PASTE_MAX_CHARS` 同值迁入——256KB，防超长剪贴板一次灌爆输入框与
 * 草稿库）。
 */
export const COMPOSER_PASTE_MAX_CHARS = 256 * 1024;

/** 自定义粘贴菜单项文案（jest 侧按此文本定位菜单项）。 */
export const COMPOSER_PASTE_MENU_LABEL = '粘贴';

/** 无模型时的 hintRow 文案（与 web dock 逐字同文案）。 */
export const COMPOSER_HINT_ROW_TEXT = '请先选择工作区模型';

export type NativeChatComposerProps = {
  /**
   * 输入框当前全文（明文真源的镜像）。
   * 打字/命令式写入产生的回声不触发写入（基线已推进，见 M1/M6）；
   * 仅外部直改 state（水化/清空/undo）会经 effect 兜底进 M7 通道。
   */
  readonly value: string;
  /** 工区有模型：placeholder 与 hintRow 显隐的真源（**不能**用 disabled 代替）。 */
  readonly hasModel: boolean;
  /** 输入禁用。走 readOnly（editable）而非 disabled 语义、不淡出——对齐 web dock。 */
  readonly disabled: boolean;
  /** 主题 9 键（`ConversationTheme`，宿主一次派发全文档生效的那组键）。 */
  readonly theme: ConversationTheme;
  /**
   * 明文变化上行（M1 纪律的唯一出口）：打字回声、M7 写入补发共用。
   * controller 侧**不区分来源**一视同仁落库（同值回声有去重）。
   */
  readonly onComposerChangeText: (text: string) => void;
  /** 选区变化上行（`{start, end}` 折叠/范围同形态，controller 只取 start）。 */
  readonly onComposerSelectionChange: (selection: {
    start: number;
    end: number;
  }) => void;
  /**
   * 输入框内容高度上抛（D7）：`onLayout` 驱动，0.5 死区 + 首帧豁免
   * （从未上报过的高度直接上抛，dock 首帧定位需要真实高度）。
   */
  readonly onHeightChange?: (height: number) => void;

  /* ---------- Step 4 · dock 外围件（门闩由上层算好传入，组件不重复实现） ---------- */

  /** 当前会话 run 活跃：发送/终止钮形态的真源。缺省回落 false。 */
  readonly running?: boolean;
  /** 可发送（`!sendDisabled`，controller 的 `resolveComposerSendIntent` 产物）。 */
  readonly canSend?: boolean;
  /** 错误行文案（空/缺省 = 不渲染）。 */
  readonly error?: string;
  /**
   * 状态 chip 文案表（I 组）：上层用 core `formatStatusChipLabelFromAttachment`
   * 算好传入，组件纯展示——不可点、不随 inputDisabled 置灰。
   */
  readonly chipLabels?: readonly string[];
  /** typeahead 候选源（files/skills，controller 按引用下发，纪律 C）。 */
  readonly typeaheadSource?: ConversationTypeaheadSource;
  /**
   * 粘贴门控的「运行中」闸（D9）。缺省回落 `running`——controller 侧两者同源，
   * 拆开是为了让调用方将来可以只关粘贴而不动发送钮形态。
   */
  readonly uiRunning?: boolean;
  /**
   * 输入域总禁用（typeahead 开合与 toolbar @/$ 的禁用判据）。缺省回落
   * `disabled`——controller 侧 `inputDisabled = !hasModel || running ||
   * lastMessageIsPlainUserText`，本体只读（disabled）与外围判据同源同值。
   */
  readonly inputDisabled?: boolean;
  /** 键盘弹起（controller 的 useAnimatedReaction 布尔翻转派生，纪律 B）。 */
  readonly keyboardUp?: boolean;
  /** 安全区底部高度（dock 底 padding 的下限取值）。 */
  readonly safeAreaBottom?: number;
  /** ⛶ 全屏编辑可用（controller 侧 = onOpenComposerFullscreen != null）。 */
  readonly fullscreenEnabled?: boolean;
  /**
   * dock 上行总口（J/K 组）：fullscreen / atPicker / skillPicker / send /
   * terminate / needModel 六种，controller 的 `handleDockAction` 直挂。
   */
  readonly onDockAction?: (action: ConversationDockAction) => void;
  /**
   * typeahead 行点选上抛（E 组）：本组件只交回候选 item（含落文 token），
   * 插入由上层经 insertTokensIntoComposer / ref.setText 落文（M7）。
   */
  readonly onTypeaheadSelect?: (item: TypeaheadItem) => void;
  readonly testID?: string;
};

export type NativeChatComposerInstance = {
  /**
   * **M7 · 命令式整段写入通道**（`useChatComposerController` 的
   * `setComposerText` 在原生侧的落点）：明文进、库内 markdown 出。
   * `cursor` 缺省时库把光标落到文本末尾（`setValueFromJS` 的默认行为）。
   */
  setText: (text: string, cursor?: number) => void;
  focus: () => void;
  blur: () => void;
};

export const NativeChatComposer = forwardRef<
  NativeChatComposerInstance,
  NativeChatComposerProps
>(
  (
    {
      value,
      hasModel,
      disabled,
      theme,
      onComposerChangeText,
      onComposerSelectionChange,
      onHeightChange,
      running = false,
      canSend = true,
      error,
      chipLabels = [],
      typeaheadSource = EMPTY_CONVERSATION_TYPEAHEAD_SOURCE,
      uiRunning,
      inputDisabled,
      keyboardUp = false,
      safeAreaBottom = 0,
      fullscreenEnabled = true,
      onDockAction,
      onTypeaheadSelect,
      testID,
    },
    ref,
  ) => {
    const inputRef = useRef<EnrichedMarkdownTextInputInstance | null>(null);

    /**
     * 最后已知明文基线（M1/M6）。初值取 value：首帧水化场景下初渲染即携带
     * 草稿明文，挂载后的 value effect 因 `value === baseline` 不再重复写入，
     * 草稿的进框由挂载 effect 的初始写入完成（见下方 useEffect 注释）。
     */
    const baselineRef = useRef(value);

    /** 已上报高度（首帧豁免的真源：null = 从未上报过）。 */
    const lastReportedHeightRef = useRef<number | null>(null);

    /** typeahead 用的明文镜像（首值同基线；只在文本路径上跟随，见文件头注释）。 */
    const [composerText, setComposerText] = useState(value);
    /** typeahead 用的光标镜像（选区起点；文本变化时先乐观塌缩到文末）。 */
    const [selectionStart, setSelectionStart] = useState(0);

    /**
     * 光标 rect 与输入区布局（简化锚定的后续接口）：先收着不进 state——
     * 精确到行的浮层锚定（caret rect + 输入区 onLayout 联合换算）等真机 QA
     * 观察整体浮层的视觉后再接，接之前不为它多付一帧 setState。
     */
    const caretRectRef = useRef<CaretRect | null>(null);
    const inputAreaLayoutRef = useRef<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>(null);

    /**
     * 首帧初值（只算一次）：库是 defaultValue 挂载语义（后续 prop 变化不重置
     * 编辑器），草稿明文在初渲染时就合成 markdown 进框；之后的 value 变化一律
     * 走 value effect / M7 通道，不再碰 defaultValue。
     * `useRef(表达式)` 每帧都会求值但只保留首帧结果——synthesize 是纯函数，
     * 草稿量级下重复求值可忽略。
     */
    const initialMarkdownRef = useRef(synthesizeTokenMarkdown(value));

    // 回调可能逐帧重建：回调链与命令式通道统一读 ref，避免旧闭包差分。
    const changeTextRef = useRef(onComposerChangeText);
    changeTextRef.current = onComposerChangeText;
    const selectionChangeRef = useRef(onComposerSelectionChange);
    selectionChangeRef.current = onComposerSelectionChange;
    const heightChangeRef = useRef(onHeightChange);
    heightChangeRef.current = onHeightChange;
    const dockActionRef = useRef(onDockAction);
    dockActionRef.current = onDockAction;
    const typeaheadSelectRef = useRef(onTypeaheadSelect);
    typeaheadSelectRef.current = onTypeaheadSelect;

    /** 门闩 props 的缺省回落（缺省语义见 props 注释）。 */
    const inputDisabledResolved = inputDisabled ?? disabled;
    const uiRunningResolved = uiRunning ?? running;

    /**
     * token ranges 下发（T-NC1 · D2 补丁二的 RN 侧消费）。
     *
     * 每次明文变化全量重扫、全量下发（库端 `setTokenRanges` 先清后加，天然
     * 幂等）。TODO(IME)：中文组合态下也照发——组合期间的区间会落在拼音串上、
     * 提交后回摆，风险面是组合中胶囊闪动/错位；「组合中挂起、提交后重扫」的
     * 收紧策略等真机 QA 观察后再做（spec D8/risk 表，Step 7 验证项）。
     */
    const dispatchTokenRanges = useCallback((plain: string) => {
      inputRef.current?.setTokenRanges(
        scanTokensToRanges(plain).map(range => ({
          start: range.start,
          end: range.end,
        })),
      );
    }, []);

    /**
     * 外部写入的内部通道（M7 语义全量）。`ref.setText`、value effect 兜底与
     * 粘贴上屏都收敛到这里，保证所有入口行为零差分。
     *
     * 输入框未挂载时（理论上 effect 晚于 ref 挂接，不会发生）直接早退且
     * **不推进基线**——让下一次 value 变化重试，避免「基线推进了、库没收到」
     * 的永久丢失。
     */
    const commitExternalText = useCallback(
      (plain: string, cursor?: number) => {
        const instance = inputRef.current;
        if (instance == null) {
          return;
        }
        baselineRef.current = plain;
        instance.setValue(synthesizeTokenMarkdown(plain));
        dispatchTokenRanges(plain);
        const resolvedCursor = cursor ?? plain.length;
        instance.setSelection(resolvedCursor, resolvedCursor);
        // E10/F6 补发语义：库在 Importing 期不自发回声，change 上抛由这里补；
        // controller 的同值去重使这条补发在所有调用场景下都是幂等回声。
        changeTextRef.current(plain);
        // typeahead 镜像同步（只在写入发生时）：写入后光标落在指定位置。
        setComposerText(plain);
        setSelectionStart(resolvedCursor);
      },
      [dispatchTokenRanges],
    );

    /** 打字路径（M6）：推进基线 → 上抛明文 → 下发 ranges；绝不回写 setValue。 */
    const handleChangeText = useCallback(
      (plain: string) => {
        baselineRef.current = plain;
        changeTextRef.current(plain);
        dispatchTokenRanges(plain);
        // typeahead 镜像同步：光标先乐观塌缩到文末（对齐 web 侧
        // `selectionStart ?? value.length` 的兜底口径），紧随其后的选区事件
        // 会用真实位置覆盖。
        setComposerText(plain);
        setSelectionStart(plain.length);
      },
      [dispatchTokenRanges],
    );

    const handleSelectionChange = useCallback(
      (selection: {start: number; end: number}) => {
        setSelectionStart(selection.start);
        selectionChangeRef.current(selection);
      },
      [],
    );

    const handleLayout = useCallback((event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      const last = lastReportedHeightRef.current;
      // 死区内的变化不上抛；last 为 null（首帧）无条件上抛——首帧豁免
      if (last != null && Math.abs(height - last) <= COMPOSER_HEIGHT_EPSILON) {
        return;
      }
      lastReportedHeightRef.current = height;
      heightChangeRef.current?.(height);
    }, []);

    /** 光标 rect 收集（不进 state，见 caretRectRef 注释）。 */
    const handleCaretRectChange = useCallback((rect: CaretRect) => {
      caretRectRef.current = rect;
    }, []);

    /** 输入区布局收集（typeahead 浮层的锚定参照，TODO 接口见 caretRectRef）。 */
    const handleInputAreaLayout = useCallback((event: LayoutChangeEvent) => {
      const {x, y, width, height} = event.nativeEvent.layout;
      inputAreaLayoutRef.current = {x, y, width, height};
    }, []);

    // value 兜底同步：外部直改 state（水化 / 清空 / undo）时经 M7 通道进框。
    // 打字与命令式写入的回声因基线已推进（M1）在此早退，M6 由这道同值闸门保住。
    useEffect(() => {
      if (value === baselineRef.current) {
        return;
      }
      commitExternalText(value);
    }, [value, commitExternalText]);

    // 挂载后对首帧内容兜底下发一次 TOKEN ranges：defaultValue 的 LINK variant
    // 已出胶囊，兜底覆盖「转义退化纯明文」的病态 token 与解析行为差异（D3 的
    // 「setValue 后 setTokenRanges 兜底」在首帧路径上的等价物）。
    useEffect(() => {
      dispatchTokenRanges(baselineRef.current);
    }, [dispatchTokenRanges]);

    useImperativeHandle(
      ref,
      () => ({
        setText: (text: string, cursor?: number) =>
          commitExternalText(text, cursor),
        focus: () => inputRef.current?.focus(),
        blur: () => inputRef.current?.blur(),
      }),
      [commitExternalText],
    );

    /* ------------------------------------------------------------------ *
     * dock 上行与 typeahead 视图（Step 4 · E/J/K 组）
     * ------------------------------------------------------------------ */

    const emitDockAction = useCallback((action: ConversationDockAction) => {
      dockActionRef.current?.(action);
    }, []);

    /**
     * typeahead 视图（纯函数算出，null = 不展开）。判据照 E5：
     * `!inputDisabled` 之外，无活跃 token / 候选空都返回 null。
     */
    const typeaheadView = useMemo(
      () =>
        computeTypeaheadView(
          composerText,
          selectionStart,
          typeaheadSource,
          !inputDisabledResolved,
        ),
      [composerText, selectionStart, typeaheadSource, inputDisabledResolved],
    );

    /**
     * 浮层容器的 React key = 幂等键（web dock `typeaheadRenderKey` 的消费面）：
     * 键同（光标随手抖动、候选集未变）复用既有挂载，键变（换 token 集/换触发
     * 形态/收起再开）才重挂——重挂顺带把浮层滚动位置归零，与 web 重渲语义一致。
     */
    const typeaheadKey = typeaheadRenderKey(typeaheadView);

    const handleTypeaheadSelect = useCallback((item: TypeaheadItem) => {
      typeaheadSelectRef.current?.(item);
    }, []);

    /**
     * 发送/终止钮状态（J 组三分支）：disabled→border 底 / running→danger 底 +
     * 终止图标 / 正常→primary 底 + 发送图标。门闩（canSend/running）由上层
     * 算好传入，本组件不重复实现 controller 的发送决策。
     */
    const sendState = resolveSendButtonState({canSend, running});

    /* ------------------------------------------------------------------ *
     * 粘贴门控（D9 / F 组）
     * ------------------------------------------------------------------ */

    /**
     * 自定义「粘贴」菜单项回调：两道闸（uiRunning / inputDisabled）任一置位
     * 即拒绝——**不读剪贴板也不上屏**（旧链 composerPaste 桥侧闸门的等价物，
     * 防止向禁用输入框注入文本、落库成草稿后下轮被发出去）。通过后读剪贴板、
     * 截断到 256KB、按触发时的选区替换插入，经 M7 通道落文并补发 change
     * （F5/F6：typeahead 点选与粘贴都是「组件自治写入」，落库靠这条补发）。
     */
    const handlePasteMenuPress = useCallback(
      (event: {selection: {start: number; end: number}}) => {
        if (uiRunningResolved || inputDisabledResolved) {
          return;
        }
        void Clipboard.getString()
          .then(raw => {
            if (raw === '') {
              return;
            }
            const truncated = raw.slice(0, COMPOSER_PASTE_MAX_CHARS);
            const {start, end} = event.selection;
            const current = baselineRef.current;
            commitExternalText(
              `${current.slice(0, start)}${truncated}${current.slice(end)}`,
              start + truncated.length,
            );
          })
          .catch(() => undefined);
      },
      [uiRunningResolved, inputDisabledResolved, commitExternalText],
    );

    /**
     * 选区菜单配置：关掉库自带的 Format 子菜单与 Copy-as-Markdown（composer
     * 的输入语义是纯文本 + token，两库项都无消费方）。平台自带的复制/粘贴等
     * 标准项不在此配置面内；TODO(patch)：内置粘贴的关闭需要补丁层给
     * `selectionMenuConfig` 加 paste 键（并行节点在收 patch 接口），落地后把
     * 内置粘贴也并进 handlePasteMenuPress 的同一道闸。
     */
    const selectionMenuConfig = useMemo<InputSelectionMenuConfig>(
      () => ({format: {enabled: false}, copyAsMarkdown: {enabled: false}}),
      [],
    );

    const contextMenuItems = useMemo<ContextMenuItem[]>(
      () => [{text: COMPOSER_PASTE_MENU_LABEL, onPress: handlePasteMenuPress}],
      [handlePasteMenuPress],
    );

    /* ------------------------------------------------------------------ *
     * 样式映射
     * ------------------------------------------------------------------ */

    /**
     * 主题 9 键 → markdownStyle：
     * - `link` 基础键直接给胶囊样式——合成 markdown 的 LINK range URL 均以
     *   `nmtoken:` / `nmskill:` 开头，非 token 的手输 `[x](y)` 在 composer 里
     *   不存在（typeahead/水化是唯一写入源），link 键与变体同样式零副作用；
     * - `linkVariants` 按库的 URL 正则匹配（Kotlin `Regex(pattern)` 编译 key）
     *   给 `^nmtoken:` / `^nmskill:` 两变体，几何数值走 dock-style.ts 单源。
     */
    const tokenCapsuleStyle = useMemo<
      NonNullable<MarkdownTextInputStyle['link']>
    >(
      () => ({
        color: theme.primary,
        underline: false,
        backgroundColor: theme.primaryMuted,
        borderRadius: composerTokenCapsule.borderRadius,
        paddingHorizontal: composerTokenCapsule.paddingHorizontal,
        paddingTop: composerTokenCapsule.paddingTop,
        paddingBottom: composerTokenCapsule.paddingBottom,
      }),
      [theme.primary, theme.primaryMuted],
    );

    const markdownStyle = useMemo<MarkdownTextInputStyle>(
      () => ({
        link: tokenCapsuleStyle,
        linkVariants: {
          '^nmtoken:': tokenCapsuleStyle,
          '^nmskill:': tokenCapsuleStyle,
        },
      }),
      [tokenCapsuleStyle],
    );

    /** 输入本体样式：尺寸取 composerInputMetrics（5 行=122 口径，D7/T-NC4）。 */
    const inputStyle = useMemo<TextStyle>(
      () => ({
        fontSize: composerInputMetrics.fontSize,
        lineHeight: composerInputMetrics.lineHeight,
        color: theme.text,
        paddingHorizontal: composerInputMetrics.paddingH,
        paddingVertical: composerInputMetrics.paddingV,
        minHeight: composerInputMetrics.minHeight,
        maxHeight: composerInputMetrics.maxHeight,
      }),
      [theme.text],
    );

    /** 发送钮底色（J 组三分支的主题映射；disabled 走 --border 即 borderLight）。 */
    const sendButtonBackground =
      sendState.variant === 'disabled'
        ? theme.borderLight
        : sendState.variant === 'danger'
        ? theme.danger
        : theme.primary;

    return (
      <View
        testID="native-composer-dock"
        style={[
          composerDockStyles.dock,
          {
            backgroundColor: theme.background,
            // 键盘顶起归零 / 否则 max(8, safeAreaBottom)（DOCK_PADDING_BASE 语义）
            paddingBottom: resolveDockBottomPadding(keyboardUp, safeAreaBottom),
          },
        ]}
      >
        {!hasModel ? (
          <Pressable
            testID="composer-hint-row"
            style={composerDockStyles.hintRow}
            onPress={() => emitDockAction('needModel')}
            accessibilityRole="button"
            accessibilityLabel={COMPOSER_HINT_ROW_TEXT}
          >
            <Text style={[composerDockStyles.hintText, {color: theme.primary}]}>
              {COMPOSER_HINT_ROW_TEXT}
            </Text>
          </Pressable>
        ) : null}

        {error != null && error !== '' ? (
          <Text
            testID="composer-error"
            style={[composerDockStyles.error, {color: theme.danger}]}
          >
            {error}
          </Text>
        ) : null}

        <View
          testID="composer-box"
          style={[
            composerDockStyles.box,
            {backgroundColor: theme.surface, borderColor: theme.borderLight},
          ]}
        >
          {chipLabels.length > 0 ? (
            <ScrollView
              testID="composer-chips"
              horizontal
              showsHorizontalScrollIndicator={false}
              style={[
                attachmentDraftChipsStyles.row,
                attachmentDraftChipsStyles.rowTransparent,
              ]}
              contentContainerStyle={attachmentDraftChipsStyles.content}
              accessibilityLabel="状态附件"
            >
              {chipLabels.map((label, index) => (
                <View
                  key={`${index}:${label}`}
                  style={[
                    attachmentDraftChipsStyles.chip,
                    {
                      backgroundColor: theme.surface,
                      borderColor: theme.borderLight,
                    },
                  ]}
                >
                  <Text
                    style={[
                      attachmentDraftChipsStyles.label,
                      {color: theme.text},
                    ]}
                    numberOfLines={1}
                  >
                    {label}
                  </Text>
                </View>
              ))}
            </ScrollView>
          ) : null}

          <View
            style={composerDockStyles.inputArea}
            onLayout={handleInputAreaLayout}
          >
            {typeaheadView != null ? (
              <View
                key={typeaheadKey}
                testID="composer-typeahead"
                accessibilityLabel={
                  typeaheadView.trigger === '@' ? '文件路径建议' : '技能建议'
                }
                style={[
                  composerTypeaheadStyles.list,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.borderLight,
                  },
                ]}
              >
                {typeaheadView.items.map(item => (
                  <Pressable
                    key={item.token}
                    testID="typeahead-row"
                    style={
                      typeaheadView.trigger === '$'
                        ? [
                            composerTypeaheadStyles.row,
                            composerTypeaheadStyles.rowSkill,
                          ]
                        : composerTypeaheadStyles.row
                    }
                    onPress={() => handleTypeaheadSelect(item)}
                    accessibilityRole="button"
                  >
                    <Text
                      style={[
                        composerTypeaheadStyles.rowLabel,
                        {color: theme.text},
                      ]}
                      numberOfLines={1}
                    >
                      {item.label}
                    </Text>
                    {item.tag !== '' ? (
                      <Text
                        style={[
                          composerTypeaheadStyles.rowTag,
                          {color: theme.textSecondary},
                        ]}
                      >
                        {item.tag}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : null}

            <EnrichedMarkdownTextInput
              ref={inputRef}
              testID={testID}
              style={inputStyle}
              markdownStyle={markdownStyle}
              defaultValue={initialMarkdownRef.current}
              placeholder={
                hasModel
                  ? COMPOSER_PLACEHOLDER_WITH_MODEL
                  : COMPOSER_PLACEHOLDER_WITHOUT_MODEL
              }
              placeholderTextColor={theme.textSecondary}
              editable={!disabled}
              // D7 高度链：false 时编辑器报告内容完整高度（onLayout 随内容长高），
              // maxHeight 钳制封顶；封顶后的滚动细节属真机 QA（Step 7）。
              scrollEnabled={false}
              onChangeText={handleChangeText}
              onChangeSelection={handleSelectionChange}
              onLayout={handleLayout}
              onCaretRectChange={handleCaretRectChange}
              selectionMenuConfig={selectionMenuConfig}
              contextMenuItems={contextMenuItems}
            />
          </View>

          <View style={composerDockStyles.toolbar}>
            {/* 左侧让位：发送钮贴右（对齐 web `.toolbar__spacer` flex:1） */}
            <View style={composerDockStyles.toolbarSpacer} />
            <Pressable
              testID="composer-fullscreen"
              onPress={() => emitDockAction('fullscreen')}
              disabled={!fullscreenEnabled}
              /* 同排按钮风格一致：与 @ / $ 同款圆钮（同尺寸、同描边），
                 字形保留 20（⛶ 笔画细、同样字号下视觉比 @/$ 小一档）。 */
              style={[composerToolBtnStyle, {borderColor: theme.borderLight}]}
              accessibilityLabel="全屏编辑"
            >
              <Text style={{color: theme.textSecondary, fontSize: 20}}>⛶</Text>
            </Pressable>
            <Pressable
              testID="composer-at-picker"
              onPress={() => emitDockAction('atPicker')}
              disabled={inputDisabledResolved}
              style={[composerToolBtnStyle, {borderColor: theme.borderLight}]}
              accessibilityLabel="引用文件"
            >
              <Text style={{color: theme.textSecondary, fontSize: 16}}>@</Text>
            </Pressable>
            <Pressable
              testID="composer-skill-picker"
              onPress={() => emitDockAction('skillPicker')}
              disabled={inputDisabledResolved}
              style={[composerToolBtnStyle, {borderColor: theme.borderLight}]}
              accessibilityLabel="引用技能"
            >
              <Text style={{color: theme.textSecondary, fontSize: 16}}>$</Text>
            </Pressable>
            <Pressable
              testID="composer-send"
              onPress={() => emitDockAction(sendState.action)}
              disabled={sendState.disabled}
              style={[
                composerDockStyles.sendBtn,
                {backgroundColor: sendButtonBackground},
              ]}
              accessibilityLabel={running ? '终止' : '发送'}
            >
              {running ? <TerminateIcon /> : <SendIcon />}
            </Pressable>
          </View>
        </View>
      </View>
    );
  },
);

/** 发送图标（对齐 web `SEND_ICON` / 退役前 RN `SendIcon` 的 18×18 双描边箭头）。 */
function SendIcon() {
  return (
    <Svg
      testID="composer-send-icon-send"
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
    >
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

/** 终止图标（对齐 web `TERMINATE_ICON` / 退役前 RN `TerminateIcon` 的 16×16 方块）。 */
function TerminateIcon() {
  return (
    <Svg
      testID="composer-send-icon-terminate"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Rect x={6} y={6} width={12} height={12} rx={2} fill="#fff" />
    </Svg>
  );
}
