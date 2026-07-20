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
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import WebView, {type WebViewMessageEvent} from 'react-native-webview';
import type {ThemeTokens} from '../../theme/tokens';
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
import {useTheme} from '../../theme/ThemeProvider';

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

  return (
    <View style={[styles.fill, style]} testID={testID}>
      <WebView
        ref={webRef}
        style={styles.fill}
        originWhitelist={['*']}
        source={{uri: getCodeEditorUri()}}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowingReadAccessToURL={getCodeEditorPackageDirUri()}
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
