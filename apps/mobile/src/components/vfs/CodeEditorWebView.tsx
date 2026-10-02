/**
 * RN WebView wrapper for VFS file edit — postMessage via CodeEditorBridge.
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
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
// 根入口 index.d.ts 未 re-export 此类型，只能从 lib/WebViewTypes 深导入；
// import type 会被擦除，不影响运行时打包。
import type {WebViewOpenWindowEvent} from 'react-native-webview/lib/WebViewTypes';
import type {ThemeTokens} from '@/theme/tokens';
import {
  encodeHostToCodeEditor,
  decodeCodeEditorToHost,
  type CodeEditorSelection,
  type CodeEditorTheme,
  type HostToCodeEditorMessage,
} from './CodeEditorBridge';
import {
  getCodeEditorPackageDirUri,
  getCodeEditorUri,
} from '@/webview-host/code-editor/uri';
import {useTheme} from '@/theme/ThemeProvider';

export type CodeEditorWebViewProps = {
  readonly value: string;
  readonly path: string;
  readonly onChange: (text: string) => void;
  /** 光标/选区上报（打字、点选、程序化写入的回声都走这里；宿主自行按需消费）。 */
  readonly onSelectionChange?: (selection: CodeEditorSelection) => void;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
  readonly onFocusChange?: (focused: boolean) => void;
};

export type CodeEditorWebViewHandle = {
  blur: () => void;
  /**
   * 程序化整段写入（token 插入等）：光标随写入一次落位。web 侧 suppressChange
   * 包裹不回抛 change；调用方自行推进本地 value/光标状态。
   */
  setText: (text: string, selection?: CodeEditorSelection) => void;
};

function themeFromTokens(tokens: ThemeTokens): CodeEditorTheme {
  return {
    background: tokens.background,
    text: tokens.text,
    textSecondary: tokens.textSecondary,
    primary: tokens.primary,
    // 胶囊底色由宿主派生下发（capsule/C-orch-1）：与 composer-input 同口径的
    // primary + 0x22 alpha，web 侧 applyHostTheme 条件式写入 --primary-muted。
    primaryMuted: `${tokens.primary}22`,
    surface: tokens.surface,
    borderLight: tokens.borderLight,
  };
}

export const CodeEditorWebView = forwardRef<
  CodeEditorWebViewHandle,
  CodeEditorWebViewProps
>(function CodeEditorWebView(
  {value, path, onChange, onSelectionChange, style, testID, onFocusChange},
  ref,
) {
  const {tokens} = useTheme();
  const webRef = useRef<WebView>(null);
  // 回环断路器（长按连删卡顿修，同 chat 侧 webTextRef/M1 纪律）：web 侧
  // change 上行的最新全文快照 + 其所属 path。value 是它的滞后镜像（经
  // onChange→父层 state 流回）——镜像连同 path 原样流回时在下行 effect 早退，
  // 杜绝「上行→setState→下行 setDocument 全文替换→undo/选区作废」的回滚回环
  // （越卡越回滚）。真外部写入（水合/setText）与镜像不同值，照常下行。
  //
  // 基线必须是 {text, path} 结构体而不是裸字符串（cr2-A-1）：光比 text 会让
  // 「同一实例换 path、草稿恰好没变」的切换（如 PromptEditorScreen 的
  // prompt.md↔composer.md）命中早退，setDocument 不下行 → web 侧 currentPath
  // 停在旧文件 → composer 胶囊按旧路径扩展失效。
  const lastUpstreamRef = useRef<{text: string; path: string} | null>(null);
  const [webReady, setWebReady] = useState(false);
  // handleMessage 的依赖数组为空，闭包里的 path 会永远是首帧值；上行基线需要
  // 当前 path，故用 ref 同步。
  const pathRef = useRef(path);
  pathRef.current = path;
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onFocusChangeRef = useRef(onFocusChange);
  onChangeRef.current = onChange;
  onSelectionChangeRef.current = onSelectionChange;
  onFocusChangeRef.current = onFocusChange;

  const postToWeb = useCallback((message: HostToCodeEditorMessage) => {
    webRef.current?.postMessage(encodeHostToCodeEditor(message));
  }, []);

  const sendInit = useCallback(() => {
    postToWeb({
      v: 1,
      type: 'init',
      payload: {theme: themeFromTokens(tokens)},
    });
  }, [postToWeb, tokens]);

  useImperativeHandle(
    ref,
    () => ({
      blur: () => {
        postToWeb({v: 1, type: 'blur', payload: {}});
      },
      setText: (text: string, selection?: CodeEditorSelection) => {
        postToWeb({
          v: 1,
          type: 'setDocument',
          payload:
            selection == null
              ? {text, path}
              : {
                  text,
                  path,
                  selectionStart: selection.start,
                  selectionEnd: selection.end,
                },
        });
      },
    }),
    [postToWeb, path],
  );

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const message = decodeCodeEditorToHost(event.nativeEvent.data);
      if (message.type === 'ready') {
        setWebReady(true);
        return;
      }
      if (message.type === 'change') {
        const text = String(message.payload.text ?? '');
        lastUpstreamRef.current = {text, path: pathRef.current};
        onChangeRef.current(text);
        return;
      }
      if (message.type === 'selectionChange') {
        const payload = message.payload;
        const start = Number(payload.start);
        const end = Number(payload.end);
        onSelectionChangeRef.current?.({
          start: Number.isFinite(start) ? start : 0,
          end: Number.isFinite(end) ? end : 0,
        });
        return;
      }
      if (message.type === 'focus') {
        onFocusChangeRef.current?.(true);
        return;
      }
      if (message.type === 'blur') {
        onFocusChangeRef.current?.(false);
      }
    } catch {
      // ignore malformed messages
    }
  }, []);

  useEffect(() => {
    if (!webReady) {
      return;
    }
    sendInit();
  }, [webReady, sendInit]);

  useEffect(() => {
    if (!webReady) {
      return;
    }
    postToWeb({
      v: 1,
      type: 'themeUpdate',
      payload: {theme: themeFromTokens(tokens)},
    });
  }, [webReady, tokens, postToWeb]);

  useEffect(() => {
    if (!webReady) {
      return;
    }
    // 回环断路（见 lastUpstreamRef 注释）：value + path 就是 web 刚上行那份
    // 全文及其归属文件的滞后镜像，原样流回不下行；基线随真下行清空（后续外部
    // 同值写入仍可下行）。path 必须一起比（cr2-A-1）——只比 value 会吞掉换
    // path 的下行，让 web 侧 currentPath 停旧值。
    const baseline = lastUpstreamRef.current;
    if (baseline != null && baseline.text === value && baseline.path === path) {
      // 早退分支同步推进基线，保证基线里的 path 不落后于当前 props。
      lastUpstreamRef.current = {text: value, path};
      return;
    }
    lastUpstreamRef.current = null;
    postToWeb({
      v: 1,
      type: 'setDocument',
      payload: {text: value, path},
    });
  }, [webReady, value, path, postToWeb]);

  /**
   * 导航守卫（sec/D-1）：只放行包目录内的 file:// 加载（初始 index.html 与同包相对资源）；
   * http/https 外跳系统浏览器并拒绝页内导航，其余 scheme 一律拒绝。
   * 外部页面无法在 WebView 内落地后，其 postMessage 伪造桥消息即无从成立。
   */
  const shouldStartLoadWithRequest = useCallback(
    (req: {url: string}): boolean => {
      if (req.url.startsWith(getCodeEditorPackageDirUri())) {
        return true;
      }
      if (/^https?:\/\//i.test(req.url)) {
        // 外跳失败（无浏览器可处理等）静默兜底：绝不回退到 WebView 页内导航。
        // 防御性保留：库自身在 originWhitelist 拦截失败时也会外跳，此处兜住回调直达的场景。
        void Linking.openURL(req.url).catch(() => undefined);
      }
      return false;
    },
    [],
  );

  /**
   * iOS window.open / target="_blank" 新开窗口兜底：拒绝 WebView 内打开，外跳系统浏览器。
   */
  const handleOpenWindow = useCallback((event: WebViewOpenWindowEvent) => {
    event.preventDefault();
    // WebViewOpenWindow 的字段是 targetUrl（新窗口目标地址），无 url 字段。
    void Linking.openURL(event.nativeEvent.targetUrl).catch(() => undefined);
  }, []);

  return (
    <View style={[styles.fill, style]} testID={testID}>
      <WebView
        ref={webRef}
        style={styles.fill}
        /* sec/D-1：收紧为包内 file://（库会自动附带 about:blank）；初始加载与同包相对资源
           均命中此前缀，已验证收紧不影响首载。白名单外的导航由库自行外跳系统浏览器。 */
        originWhitelist={['file://']}
        source={{uri: getCodeEditorUri()}}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowingReadAccessToURL={getCodeEditorPackageDirUri()}
        onShouldStartLoadWithRequest={shouldStartLoadWithRequest}
        onOpenWindow={handleOpenWindow}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        /* CM owns vertical scroll; RN scrollEnabled=false avoids nested scroll. */
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        keyboardDisplayRequiresUserAction={false}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  fill: {flex: 1, minHeight: 0},
});
