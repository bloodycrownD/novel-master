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
  type RichDocumentSelectionCollectPayload,
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

/**
 * 应急：恢复旧 setAnnotations 搜字链。默认 false。
 * 测试或运维可在 RN 侧置 true（须与 Web `globalThis.__NM_ANNOTATE_DOM_SEARCH_FALLBACK__` 同步）。
 */
export let NM_ANNOTATE_DOM_SEARCH_FALLBACK = false;

export function setNmAnnotateDomSearchFallbackForTests(enabled: boolean): void {
  NM_ANNOTATE_DOM_SEARCH_FALLBACK = enabled === true;
}

export type RichDocumentAnnotateCollectMode = 'plain' | 'markdown';

export type RichDocumentWebViewProps = {
  readonly html?: string;
  readonly plain?: string;
  readonly overLimit?: boolean;
  readonly frontMatterHtml?: string;
  /**
   * html 布局：文本认锚用 `plain`（pre-wrap）；Markdown 用 `rich`（缺省）。
   */
  readonly layout?: 'plain' | 'rich';
  readonly style?: StyleProp<ViewStyle>;
  /** 划词批注入口（仅 session 预览态由上层打开）。 */
  readonly annotateEnabled?: boolean;
  /**
   * 划词采集模式：plain → injectJS 半开 offset；markdown → 邻域。
   * 缺省按是否有 html 推断（有 html 且 layout!==plain → markdown）。
   */
  readonly annotateCollectMode?: RichDocumentAnnotateCollectMode;
  /** @deprecated 仅应急开关下投递。 */
  readonly annotations?: readonly RichDocumentAnnotationMark[];
  /** @deprecated 仅应急。 */
  readonly annotateSourceText?: string;
  /**
   * menuItems「批注」→ injectJS 采集后的主回调（Step 5 主通道）。
   */
  readonly onAnnotateCollect?: (
    payload: RichDocumentSelectionCollectPayload,
  ) => void;
  /**
   * @deprecated 遗留：仅有 selectedText 时的降级；主路径请用 onAnnotateCollect。
   */
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
  layout: 'plain' | 'rich' | undefined,
): HostToRichDocumentMessage {
  const fm = frontMatterHtml || undefined;
  if (html != null && html.length > 0 && !overLimit) {
    return {
      v: 1,
      type: 'setDocument',
      payload: {
        mode: 'html',
        html,
        overLimit: false,
        frontMatterHtml: fm,
        ...(layout ? {layout} : {}),
      },
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

function resolveCollectMode(
  explicit: RichDocumentAnnotateCollectMode | undefined,
  html: string | undefined,
  layout: 'plain' | 'rich' | undefined,
): RichDocumentAnnotateCollectMode {
  if (explicit === 'plain' || explicit === 'markdown') {
    return explicit;
  }
  if (layout === 'plain') {
    return 'plain';
  }
  if (html != null && html.length > 0) {
    return 'markdown';
  }
  return 'plain';
}

export function RichDocumentWebView({
  html,
  plain,
  overLimit = false,
  frontMatterHtml,
  layout,
  style,
  annotateEnabled = false,
  annotateCollectMode,
  annotations = EMPTY_ANNOTATIONS,
  annotateSourceText,
  onAnnotateCollect,
  onSelectionAnnotate,
  onAnnotateOpen,
}: RichDocumentWebViewProps) {
  const {tokens} = useTheme();
  const webRef = useRef<WebView>(null);
  const [webReady, setWebReady] = useState(false);
  const onAnnotateCollectRef = useRef(onAnnotateCollect);
  const onSelectionAnnotateRef = useRef(onSelectionAnnotate);
  const onAnnotateOpenRef = useRef(onAnnotateOpen);
  onAnnotateCollectRef.current = onAnnotateCollect;
  onSelectionAnnotateRef.current = onSelectionAnnotate;
  onAnnotateOpenRef.current = onAnnotateOpen;

  const collectMode = resolveCollectMode(annotateCollectMode, html, layout);

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
      if (message.type === 'selectionCollect') {
        const p = message.payload;
        const text = String(p.originalText ?? '')
          .replace(/\u00a0/g, ' ')
          .trim();
        if (!text) {
          return;
        }
        onAnnotateCollectRef.current?.({
          originalText: text,
          mode: p.mode === 'plain' ? 'plain' : 'markdown',
          ...(typeof p.selectionStart === 'number'
            ? {selectionStart: p.selectionStart}
            : {}),
          ...(typeof p.selectionEnd === 'number'
            ? {selectionEnd: p.selectionEnd}
            : {}),
          ...(typeof p.contextBefore === 'string'
            ? {contextBefore: p.contextBefore}
            : {}),
          ...(typeof p.contextAfter === 'string'
            ? {contextAfter: p.contextAfter}
            : {}),
        });
        return;
      }
      if (message.type === 'selectionAnnotate') {
        // 遗留通道：降级为仅原文
        const text = String(message.payload.text ?? '').trim();
        if (text) {
          onAnnotateCollectRef.current?.({
            originalText: text,
            mode: 'markdown',
          });
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
   * 主路径：只 setDocument + setAnnotateEnabled。
   * setAnnotations 仅应急开关（默认关）。
   */
  useEffect(() => {
    if (!webReady) {
      return;
    }
    postToWeb(
      buildSetDocumentPayload(html, plain, overLimit, frontMatterHtml, layout),
    );
    postToWeb({
      v: 1,
      type: 'setAnnotateEnabled',
      payload: {enabled: annotateEnabled === true},
    });
    if (NM_ANNOTATE_DOM_SEARCH_FALLBACK && annotateEnabled) {
      postToWeb({
        v: 1,
        type: 'setAnnotations',
        payload: {
          annotations: annotations.map(a => ({
            id: a.id,
            originalText: a.originalText,
            ...(typeof a.startLine === 'number'
              ? {startLine: a.startLine}
              : {}),
            ...(typeof a.endLine === 'number' ? {endLine: a.endLine} : {}),
            ...(typeof a.startCol === 'number' ? {startCol: a.startCol} : {}),
            ...(typeof a.endCol === 'number' ? {endCol: a.endCol} : {}),
          })),
          ...(typeof annotateSourceText === 'string' &&
          annotateSourceText.length > 0
            ? {sourceText: annotateSourceText}
            : {}),
        },
      });
    }
  }, [
    webReady,
    html,
    plain,
    overLimit,
    frontMatterHtml,
    layout,
    annotateEnabled,
    annotations,
    annotateSourceText,
    postToWeb,
  ]);

  const requestSelectionCollect = useCallback(
    (fallbackText: string) => {
      const mode = collectMode;
      const escaped = mode === 'plain' ? 'plain' : 'markdown';
      // 菜单回调通常只有 selectedText；injectJS 补 offset / 邻域
      webRef.current?.injectJavaScript(
        `(function(){try{if(typeof window.__nmCollectAnnotateSelection==='function'){window.__nmCollectAnnotateSelection('${escaped}');}else{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({v:1,type:'selectionCollect',payload:{originalText:${JSON.stringify(fallbackText)},mode:'${escaped}'}}));}}catch(e){} true;})();`,
      );
    },
    [collectMode],
  );

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
        if (onAnnotateCollectRef.current) {
          requestSelectionCollect(text);
          return;
        }
        // 无 collect 回调时降级（测试 / 旧接线）
        onSelectionAnnotateRef.current?.(text);
        return;
      }
      if (key === 'copy') {
        Clipboard.setString(text);
      }
    },
    [annotateEnabled, requestSelectionCollect],
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
