/**
 * RN WebView wrapper for VFS markdown preview body — postMessage via RichDocumentBridge.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import WebView, {type WebViewMessageEvent} from 'react-native-webview';
import type {ThemeTokens} from '../../theme/tokens';
import {
  encodeHostToRichDocument,
  decodeRichDocumentToHost,
  type HostToRichDocumentMessage,
  type RichDocumentAnnotationMark,
  type RichDocumentTheme,
} from './RichDocumentBridge';
import {
  getRichDocumentPackageDirUri,
  getRichDocumentUri,
} from '@/webview-host/rich-document/uri';
import {useTheme} from '../../theme/ThemeProvider';

const EMPTY_ANNOTATIONS: readonly RichDocumentAnnotationMark[] = [];

/** 划词开启时替换系统选区菜单（自定义项会盖掉原生 Copy/Share，故自备「复制」）。 */
export const RICH_DOCUMENT_ANNOTATE_MENU_ITEMS = [
  {label: '批注', key: 'annotate'},
  {label: '复制', key: 'copy'},
] as const;

export type RichDocumentWebViewProps = {
  readonly html?: string;
  readonly plain?: string;
  readonly overLimit?: boolean;
  readonly frontMatterHtml?: string;
  readonly style?: StyleProp<ViewStyle>;
  /** 划词批注入口（仅 session 预览态由上层打开）。 */
  readonly annotateEnabled?: boolean;
  readonly annotations?: readonly RichDocumentAnnotationMark[];
  /** 磁盘源文件全文，供 WebView 窗口优先匹配。 */
  readonly annotateSourceText?: string;
  readonly onSelectionAnnotate?: (text: string) => void;
  /** 同文多条时传入全部 id，由上层弹出选择列表。 */
  readonly onAnnotateOpen?: (ids: readonly string[]) => void;
};

function themeFromTokens(tokens: ThemeTokens): RichDocumentTheme {
  return {
    background: tokens.background,
    text: tokens.text,
    textSecondary: tokens.textSecondary,
    primary: tokens.primary,
    surface: tokens.surface,
    borderLight: tokens.borderLight,
  };
}

function buildSetDocumentPayload(
  html: string | undefined,
  plain: string | undefined,
  overLimit: boolean,
  frontMatterHtml: string | undefined,
): HostToRichDocumentMessage {
  const fm = frontMatterHtml || undefined;
  if (html != null && html.length > 0 && !overLimit) {
    return {
      v: 1,
      type: 'setDocument',
      payload: {mode: 'html', html, overLimit: false, frontMatterHtml: fm},
    };
  }
  return {
    v: 1,
    type: 'setDocument',
    payload: {
      mode: 'plain',
      plain: plain ?? '',
      overLimit,
      frontMatterHtml: fm,
    },
  };
}

export function RichDocumentWebView({
  html,
  plain,
  overLimit = false,
  frontMatterHtml,
  style,
  annotateEnabled = false,
  annotations = EMPTY_ANNOTATIONS,
  annotateSourceText,
  onSelectionAnnotate,
  onAnnotateOpen,
}: RichDocumentWebViewProps) {
  const {tokens} = useTheme();
  const webRef = useRef<WebView>(null);
  const [webReady, setWebReady] = useState(false);
  const onSelectionAnnotateRef = useRef(onSelectionAnnotate);
  const onAnnotateOpenRef = useRef(onAnnotateOpen);
  onSelectionAnnotateRef.current = onSelectionAnnotate;
  onAnnotateOpenRef.current = onAnnotateOpen;

  const postToWeb = useCallback((message: HostToRichDocumentMessage) => {
    webRef.current?.postMessage(encodeHostToRichDocument(message));
  }, []);

  const sendInit = useCallback(() => {
    postToWeb({
      v: 1,
      type: 'init',
      payload: {theme: themeFromTokens(tokens)},
    });
  }, [postToWeb, tokens]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const message = decodeRichDocumentToHost(event.nativeEvent.data);
      if (message.type === 'ready') {
        setWebReady(true);
        return;
      }
      if (message.type === 'selectionAnnotate') {
        const text = String(message.payload.text ?? '').trim();
        if (text) {
          onSelectionAnnotateRef.current?.(text);
        }
        return;
      }
      if (message.type === 'annotateOpen') {
        const rawIds = message.payload.ids;
        const ids = Array.isArray(rawIds)
          ? rawIds.map(id => String(id ?? '')).filter(id => id.length > 0)
          : [];
        if (ids.length > 0) {
          onAnnotateOpenRef.current?.(ids);
        }
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

  /**
   * 文档与 annotations 同批投递：先 setDocument 再 setAnnotations。
   * 避免分 effect 时空 marks / 旧 marks 与新文档错配，或滞后帧盖住最终下划线。
   */
  useEffect(() => {
    if (!webReady) {
      return;
    }
    postToWeb(buildSetDocumentPayload(html, plain, overLimit, frontMatterHtml));
    postToWeb({
      v: 1,
      type: 'setAnnotateEnabled',
      payload: {enabled: annotateEnabled === true},
    });
    postToWeb({
      v: 1,
      type: 'setAnnotations',
      payload: {
        annotations: annotateEnabled
          ? annotations.map(a => ({
              id: a.id,
              originalText: a.originalText,
              ...(typeof a.startLine === 'number'
                ? {startLine: a.startLine}
                : {}),
              ...(typeof a.endLine === 'number' ? {endLine: a.endLine} : {}),
              ...(typeof a.startCol === 'number' ? {startCol: a.startCol} : {}),
              ...(typeof a.endCol === 'number' ? {endCol: a.endCol} : {}),
            }))
          : [],
        ...(annotateEnabled &&
        typeof annotateSourceText === 'string' &&
        annotateSourceText.length > 0
          ? {sourceText: annotateSourceText}
          : {}),
      },
    });
  }, [
    webReady,
    html,
    plain,
    overLimit,
    frontMatterHtml,
    annotateEnabled,
    annotations,
    annotateSourceText,
    postToWeb,
  ]);

  const handleCustomMenuSelection = useCallback(
    (event: {nativeEvent: {key?: string; selectedText?: string}}) => {
      if (!annotateEnabled) {
        return;
      }
      const key = String(event.nativeEvent.key ?? '');
      const text = String(event.nativeEvent.selectedText ?? '')
        .replace(/\u00a0/g, ' ')
        .trim();
      if (!text) {
        return;
      }
      if (key === 'annotate') {
        onSelectionAnnotateRef.current?.(text);
        return;
      }
      if (key === 'copy') {
        Clipboard.setString(text);
      }
    },
    [annotateEnabled],
  );

  return (
    <View style={[styles.fill, style]}>
      <WebView
        ref={webRef}
        style={styles.fill}
        originWhitelist={['*']}
        source={{uri: getRichDocumentUri()}}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowingReadAccessToURL={getRichDocumentPackageDirUri()}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        /* WebView owns vertical scroll (#doc overflow-y); RN scrollEnabled=false avoids nested scroll. */
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        keyboardDisplayRequiresUserAction={false}
        /* 划词批注：自定义选区菜单替换系统项；须自备「复制」。 */
        menuItems={
          annotateEnabled
            ? [...RICH_DOCUMENT_ANNOTATE_MENU_ITEMS]
            : undefined
        }
        onCustomMenuSelection={
          annotateEnabled ? handleCustomMenuSelection : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1, minHeight: 0},
});
