/**
 * Composer 输入框 WebView 通用宿主（chat 内联 / 宏内联 / chat 全屏三处复用）。
 *
 * 受控桥模式照 `components/vfs/CodeEditorWebView.tsx`：web 侧自持真源——打字只在
 * web 内 `input` 事件后上报 `change`，宿主收到只上抛 onChangeText、**绝不回写**
 * （v1.5.9 的 IME 防线）；`setText` 仅外部变化（水化 / typeahead 点选 / 清空 /
 * 全屏回填）时下发。一切下行以 `ready` 为门控。
 *
 * 高度所有权在 web：`heightChange`（值已按 metrics clamp）驱动宿主容器高度跟随；
 * `metrics.maxHeight = null`（chat 全屏）时 web 不上报，容器 flex 全高。
 *
 * metrics 为挂载期静态参数（协议无 setMetrics）：全屏屏用独立实例 + 解除限高，
 * 不复用内联实例改尺寸。
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
import {
  Linking,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import WebView, {type WebViewMessageEvent} from 'react-native-webview';
import type {ThemeTokens} from '@/theme/tokens';
import {useTheme} from '@/theme/ThemeProvider';
import {
  getComposerInputPackageDirUri,
  getComposerInputUri,
} from '@/webview-host/composer-input/uri';
import {
  COMPOSER_INPUT_BRIDGE_VERSION,
  decodeComposerInputToHost,
  encodeHostToComposerInput,
  type ComposerInputMetrics,
  type ComposerInputMode,
  type ComposerInputSelection,
  type ComposerInputTheme,
  type HostToComposerInputMessage,
} from './ComposerInputBridge';

export type ComposerInputWebViewProps = {
  /** 高亮分段来源：chat 链 token / 宏链白名单宏。 */
  readonly mode: ComposerInputMode;
  /** 外部真源文本（只为识别「外部变化」；打字真源在 web 侧）。 */
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  /** web 上报的选区（宿主合成为普通对象，RN 侧壳再包装成事件形状）。 */
  readonly onSelectionChange?: (selection: ComposerInputSelection) => void;
  /** 内容高度上报（已按 metrics clamp；容器高度由此驱动）。 */
  readonly onHeight?: (height: number) => void;
  readonly disabled?: boolean;
  /**
   * 外部受控选区：变化（且非自身回声）时下发 setSelection。
   * null / 缺省 = 不干预（用户点选、IME 移动光标都不受控）。
   */
  readonly selection?: ComposerInputSelection | null;
  readonly metrics: ComposerInputMetrics;
  readonly placeholder?: string;
  /**
   * 主题覆盖（宏壳 props.tokens 通道）；缺省用 useTheme() tokens 组装
   * （`primaryMuted = ${primary}22`，web 不做颜色计算）。
   */
  readonly theme?: ComposerInputTheme | null;
  readonly testID?: string;
  /** 容器样式；高度由宿主按 metrics 与 heightChange 管理，勿在此覆盖。 */
  readonly style?: StyleProp<ViewStyle>;
};

export type ComposerInputWebViewHandle = {
  /**
   * 命令式整段写入（typeahead 点选 / chips 插入）：写 web + 同步 web 文本基线，
   * 光标随 payload 一次落位；web 侧 suppressChange 包裹，不回抛 change。
   */
  setText: (text: string, selection?: ComposerInputSelection | null) => void;
  /** 外部要求失焦（照 code-editor）。 */
  blur: () => void;
};

/** 主题组装：tokens → 桥主题（胶囊 = primary 字 + primaryMuted 底）。 */
function themeFromTokens(tokens: ThemeTokens): ComposerInputTheme {
  return {
    background: tokens.background,
    text: tokens.text,
    textSecondary: tokens.textSecondary,
    primary: tokens.primary,
    primaryMuted: `${tokens.primary}22`,
    selection: tokens.selection,
  };
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sameSelection(
  a: ComposerInputSelection | null,
  b: ComposerInputSelection | null,
): boolean {
  return a != null && b != null && a.start === b.start && a.end === b.end;
}

export const ComposerInputWebView = forwardRef<
  ComposerInputWebViewHandle,
  ComposerInputWebViewProps
>(function ComposerInputWebView(
  {
    mode,
    value,
    onChangeText,
    onSelectionChange,
    onHeight,
    disabled = false,
    selection = null,
    metrics,
    placeholder = '',
    theme,
    testID,
    style,
  },
  ref,
) {
  const {tokens} = useTheme();
  const webRef = useRef<WebView>(null);
  const [webReady, setWebReady] = useState(false);
  /** 容器高度：初始按 metrics.minHeight，随 heightChange 跟随（web 侧已 clamp）。 */
  const [currentHeight, setCurrentHeight] = useState(() => metrics.minHeight);

  /** web 侧文本基线：change 上报或我们下发 setText 时推进；value 差分基准。 */
  const webTextRef = useRef('');
  /** web 侧选区基线：web 上报或我们下发，用于 selection prop 的回声抑制。 */
  const lastSelectionRef = useRef<ComposerInputSelection | null>(null);
  /** 最近一次下发的主题（init 已含，同值不重发 themeUpdate）。 */
  const lastThemeJsonRef = useRef<string | null>(null);
  /** 最近一次下发的禁用态（init 已含，同值不重发 setDisabled）。 */
  const lastDisabledRef = useRef<boolean | null>(null);

  const onChangeTextRef = useRef(onChangeText);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onHeightRef = useRef(onHeight);
  onChangeTextRef.current = onChangeText;
  onSelectionChangeRef.current = onSelectionChange;
  onHeightRef.current = onHeight;

  const resolvedTheme = useMemo(
    () => theme ?? themeFromTokens(tokens),
    [theme, tokens],
  );

  /** init 是 ready 后一次性快照：取当拍值（此后变化各有专线消息）。 */
  const initSnapshotRef = useRef({
    mode,
    disabled,
    theme: resolvedTheme,
    metrics,
    placeholder,
  });
  initSnapshotRef.current = {
    mode,
    disabled,
    theme: resolvedTheme,
    metrics,
    placeholder,
  };

  const postToWeb = useCallback((message: HostToComposerInputMessage) => {
    webRef.current?.postMessage(encodeHostToComposerInput(message));
  }, []);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    let message: ReturnType<typeof decodeComposerInputToHost>;
    try {
      message = decodeComposerInputToHost(event.nativeEvent.data);
    } catch {
      // 坏信封（JSON 坏 / v 不符 / type 缺失）静默丢弃，对齐三域先例。
      return;
    }
    if (message.type === 'ready') {
      setWebReady(true);
      return;
    }
    if (message.type === 'change') {
      const text = String(message.payload.text ?? '');
      // 打字真源在 web：只推进基线 + 上抛，绝不回写 setText。
      webTextRef.current = text;
      onChangeTextRef.current(text);
      return;
    }
    if (message.type === 'selectionChange') {
      const next = {
        start: finiteOrNull(message.payload.start) ?? 0,
        end: finiteOrNull(message.payload.end) ?? 0,
      };
      lastSelectionRef.current = next;
      onSelectionChangeRef.current?.(next);
      return;
    }
    if (message.type === 'heightChange') {
      const height = finiteOrNull(message.payload.height);
      if (height != null) {
        setCurrentHeight(height);
        onHeightRef.current?.(height);
      }
      return;
    }
    // focus / blur：键盘链路由 keyboard-controller insets 驱动，当前无消费，丢弃。
  }, []);

  // init：ready 后一次（web 一切装配的入口）。
  useEffect(() => {
    if (!webReady) {
      return;
    }
    const snapshot = initSnapshotRef.current;
    lastThemeJsonRef.current = JSON.stringify(snapshot.theme);
    lastDisabledRef.current = snapshot.disabled;
    postToWeb({
      v: COMPOSER_INPUT_BRIDGE_VERSION,
      type: 'init',
      payload: {
        mode: snapshot.mode,
        disabled: snapshot.disabled,
        theme: snapshot.theme,
        metrics: snapshot.metrics,
        placeholder: snapshot.placeholder,
      },
    });
  }, [webReady, postToWeb]);

  // themeUpdate：亮暗切换等主题变化（init 已发过的同值不重发）。
  useEffect(() => {
    if (!webReady) {
      return;
    }
    const json = JSON.stringify(resolvedTheme);
    if (lastThemeJsonRef.current === json) {
      return;
    }
    lastThemeJsonRef.current = json;
    postToWeb({
      v: COMPOSER_INPUT_BRIDGE_VERSION,
      type: 'themeUpdate',
      payload: {theme: resolvedTheme},
    });
  }, [webReady, resolvedTheme, postToWeb]);

  // setText：仅外部变化（水化 / 清空 / 回填）；与 web 基线相同则短路（web 自持真源）。
  useEffect(() => {
    if (!webReady) {
      return;
    }
    if (value === webTextRef.current) {
      return;
    }
    webTextRef.current = value;
    postToWeb({
      v: COMPOSER_INPUT_BRIDGE_VERSION,
      type: 'setText',
      payload: {text: value},
    });
  }, [webReady, value, postToWeb]);

  // setSelection：外部受控选区变化（web 刚上报的同值 = 自身回声，跳过）。
  useEffect(() => {
    if (!webReady || selection == null) {
      return;
    }
    if (sameSelection(lastSelectionRef.current, selection)) {
      return;
    }
    const next = {start: selection.start, end: selection.end};
    lastSelectionRef.current = next;
    postToWeb({
      v: COMPOSER_INPUT_BRIDGE_VERSION,
      type: 'setSelection',
      payload: next,
    });
  }, [webReady, selection, postToWeb]);

  // setDisabled：运行态切换（chat 链 running / 宏链只读详情）。
  useEffect(() => {
    if (!webReady) {
      return;
    }
    if (lastDisabledRef.current === disabled) {
      return;
    }
    lastDisabledRef.current = disabled;
    postToWeb({
      v: COMPOSER_INPUT_BRIDGE_VERSION,
      type: 'setDisabled',
      payload: {disabled},
    });
  }, [webReady, disabled, postToWeb]);

  useImperativeHandle(
    ref,
    () => ({
      setText(text: string, nextSelection?: ComposerInputSelection | null) {
        if (!webReady) {
          // 未就绪不写基线：ready 后 value 差分 effect 会用最新 props 补齐全量写入。
          return;
        }
        webTextRef.current = text;
        if (nextSelection != null) {
          lastSelectionRef.current = {
            start: nextSelection.start,
            end: nextSelection.end,
          };
        }
        postToWeb({
          v: COMPOSER_INPUT_BRIDGE_VERSION,
          type: 'setText',
          payload:
            nextSelection == null
              ? {text}
              : {
                  text,
                  selectionStart: nextSelection.start,
                  selectionEnd: nextSelection.end,
                },
        });
      },
      blur() {
        if (!webReady) {
          return;
        }
        postToWeb({
          v: COMPOSER_INPUT_BRIDGE_VERSION,
          type: 'blur',
          payload: {},
        });
      },
    }),
    [webReady, postToWeb],
  );

  /**
   * 导航守卫（sec/D-1，照 code-editor）：只放行包目录内的 file:// 加载（初始
   * index.html 与同包相对资源）；http/https 外跳系统浏览器并拒绝页内导航，
   * 其余 scheme 一律拒绝。外部页面无法在 WebView 内落地，其伪造桥消息即无从成立。
   */
  const shouldStartLoadWithRequest = useCallback((req: {url: string}): boolean => {
    if (req.url.startsWith(getComposerInputPackageDirUri())) {
      return true;
    }
    if (/^https?:\/\//i.test(req.url)) {
      // 外跳失败（无浏览器可处理等）静默兜底：绝不回退到 WebView 页内导航。
      void Linking.openURL(req.url).catch(() => undefined);
    }
    return false;
  }, []);

  // 不限高（chat 全屏）：容器 flex 全高，web 侧 css max-height: none。
  const unbounded = metrics.maxHeight == null;

  return (
    <View
      style={[unbounded ? styles.fill : {height: currentHeight}, style]}
      testID={testID}
    >
      <WebView
        ref={webRef}
        /* 背景透明：底色由 RN 容器给（web 侧 html/body 亦不上色）。 */
        style={styles.webview}
        originWhitelist={['file://']}
        source={{uri: getComposerInputUri()}}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowingReadAccessToURL={getComposerInputPackageDirUri()}
        onShouldStartLoadWithRequest={shouldStartLoadWithRequest}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        /* web 侧高亮层自持滚动；RN 层关滚动避免嵌套滚动打架。 */
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        keyboardDisplayRequiresUserAction={false}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  fill: {flex: 1, minHeight: 0},
  webview: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
});
