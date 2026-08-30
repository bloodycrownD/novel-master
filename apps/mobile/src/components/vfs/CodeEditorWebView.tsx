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
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
  readonly onFocusChange?: (focused: boolean) => void;
};

export type CodeEditorWebViewHandle = {
  blur: () => void;
};

function themeFromTokens(tokens: ThemeTokens): CodeEditorTheme {
  return {
    background: tokens.background,
    text: tokens.text,
    textSecondary: tokens.textSecondary,
    primary: tokens.primary,
    surface: tokens.surface,
    borderLight: tokens.borderLight,
  };
}

export const CodeEditorWebView = forwardRef<
  CodeEditorWebViewHandle,
  CodeEditorWebViewProps
>(function CodeEditorWebView(
  {value, path, onChange, style, testID, onFocusChange},
  ref,
) {
  const {tokens} = useTheme();
  const webRef = useRef<WebView>(null);
  const [webReady, setWebReady] = useState(false);
  const onChangeRef = useRef(onChange);
  const onFocusChangeRef = useRef(onFocusChange);
  onChangeRef.current = onChange;
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
    }),
    [postToWeb],
  );

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const message = decodeCodeEditorToHost(event.nativeEvent.data);
      if (message.type === 'ready') {
        setWebReady(true);
        return;
      }
      if (message.type === 'change') {
        onChangeRef.current(String(message.payload.text ?? ''));
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
