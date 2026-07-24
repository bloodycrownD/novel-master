/**
 * RN WebView wrapper for VFS markdown preview body — postMessage via RichDocumentBridge.
 * MD 批注：干净 HTML + Recogito 仅投影；新建走原生选区菜单「复制/批注」+ inject 采集。
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import WebView, {type WebViewMessageEvent} from 'react-native-webview';
import Clipboard from '@react-native-clipboard/clipboard';
import type {ThemeTokens} from '../../theme/tokens';
import {
  encodeHostToRichDocument,
  decodeRichDocumentToHost,
  type HostToRichDocumentMessage,
  type RichDocumentAnnotationMark,
  type RichDocumentRecogitoCreatePayload,
  type RichDocumentTheme,
} from './RichDocumentBridge';
import {
  getRichDocumentPackageDirUri,
  getRichDocumentUri,
} from '@/webview-host/rich-document/uri';
import {useTheme} from '../../theme/ThemeProvider';

const EMPTY_ANNOTATIONS: readonly RichDocumentAnnotationMark[] = [];

/**
 * 文件预览划词菜单：自定义项会盖掉原生 Copy，须自备「复制」。
 * 批注 → inject 量测 Recogito 坐标系；勿让 Recogito 划词即建批注。
 */
export const RICH_DOCUMENT_ANNOTATE_MENU_ITEMS = [
  {label: '复制', key: 'copy'},
  {label: '批注', key: 'annotate'},
] as const;

const COLLECT_RECOGITO_JS =
  '(function(){try{window.__nmCollectRecogitoSelection&&window.__nmCollectRecogitoSelection();}catch(e){} true;})();';

export type RichDocumentWebViewProps = {
  readonly html?: string;
  readonly plain?: string;
  readonly overLimit?: boolean;
  readonly frontMatterHtml?: string;
  /**
   * html 布局：文本用 `plain`（pre-wrap）；Markdown 用 `rich`（缺省）。
   */
  readonly layout?: 'plain' | 'rich';
  readonly style?: StyleProp<ViewStyle>;
  /** 划词批注入口（仅 session 预览 + MD Tab 由上层打开）。 */
  readonly annotateEnabled?: boolean;
  /** Recogito 投影列表（仅含 renderStart/renderEnd 的草稿）。 */
  readonly annotations?: readonly RichDocumentAnnotationMark[];
  /** 菜单「批注」采集成功 → 宿主写草稿。 */
  readonly onRecogitoCreate?: (
    payload: RichDocumentRecogitoCreatePayload,
  ) => void;
  /** 同文多条时传入全部 id，由上层弹出选择列表。 */
  readonly onAnnotateOpen?: (ids: readonly string[]) => void;
  /**
   * 递增时通知 WebView `clearAnnotateSelection`（关详情弹窗后清选中，避免二次点击卡顿）。
   */
  readonly clearAnnotateSelectionSignal?: number;
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

export function RichDocumentWebView({
  html,
  plain,
  overLimit = false,
  frontMatterHtml,
  layout,
  style,
  annotateEnabled = false,
  annotations = EMPTY_ANNOTATIONS,
  onRecogitoCreate,
  onAnnotateOpen,
  clearAnnotateSelectionSignal = 0,
}: RichDocumentWebViewProps) {
  const {tokens} = useTheme();
  const webRef = useRef<WebView>(null);
  const [webReady, setWebReady] = useState(false);
  const onRecogitoCreateRef = useRef(onRecogitoCreate);
  const onAnnotateOpenRef = useRef(onAnnotateOpen);
  onRecogitoCreateRef.current = onRecogitoCreate;
  onAnnotateOpenRef.current = onAnnotateOpen;

  const postToWeb = useCallback((message: HostToRichDocumentMessage) => {
    webRef.current?.postMessage(encodeHostToRichDocument(message));
  }, []);

  const handleCustomMenuSelection = useCallback(
    (event: {
      nativeEvent: {
        key?: string;
        label?: string;
        selectedText?: string;
      };
    }) => {
      const key = String(event.nativeEvent.key ?? '');
      const selectedText = String(event.nativeEvent.selectedText ?? '');
      if (key === 'copy') {
        if (selectedText.length > 0) {
          Clipboard.setString(selectedText);
        }
        return;
      }
      if (key !== 'annotate' || annotateEnabled !== true) {
        return;
      }
      webRef.current?.injectJavaScript(COLLECT_RECOGITO_JS);
    },
    [annotateEnabled],
  );

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
      if (message.type === 'recogitoCreate') {
        const p = message.payload;
        const quote = String(p.quote ?? '')
          .replace(/\u00a0/g, ' ');
        const renderStart = Number(p.renderStart);
        const renderEnd = Number(p.renderEnd);
        if (
          !quote.trim() ||
          !Number.isFinite(renderStart) ||
          !Number.isFinite(renderEnd) ||
          renderStart < 0 ||
          renderEnd <= renderStart
        ) {
          return;
        }
        onRecogitoCreateRef.current?.({
          quote,
          renderStart,
          renderEnd,
          ...(typeof p.tempId === 'string' && p.tempId.length > 0
            ? {tempId: p.tempId}
            : {}),
        });
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
   * 文档内容变化才 setDocument（会销毁并重建 Recogito）。
   * 切勿与 annotations 绑在同一 effect，否则每改草稿都整页重渲 → 二次点击极卡。
   */
  useEffect(() => {
    if (!webReady) {
      return;
    }
    postToWeb(
      buildSetDocumentPayload(html, plain, overLimit, frontMatterHtml, layout),
    );
  }, [
    webReady,
    html,
    plain,
    overLimit,
    frontMatterHtml,
    layout,
    postToWeb,
  ]);

  useEffect(() => {
    if (!webReady) {
      return;
    }
    postToWeb({
      v: 1,
      type: 'setAnnotateEnabled',
      payload: {enabled: annotateEnabled === true},
    });
  }, [webReady, annotateEnabled, postToWeb]);

  useEffect(() => {
    if (!webReady || annotateEnabled !== true) {
      return;
    }
    postToWeb({
      v: 1,
      type: 'setAnnotations',
      payload: {
        annotations: annotations.map(a => ({
          id: a.id,
          originalText: a.originalText,
          renderStart: a.renderStart,
          renderEnd: a.renderEnd,
        })),
      },
    });
  }, [webReady, annotateEnabled, annotations, postToWeb]);

  useEffect(() => {
    if (!webReady || annotateEnabled !== true) {
      return;
    }
    if (clearAnnotateSelectionSignal <= 0) {
      return;
    }
    postToWeb({
      v: 1,
      type: 'clearAnnotateSelection',
      payload: {},
    });
  }, [
    webReady,
    annotateEnabled,
    clearAnnotateSelectionSignal,
    postToWeb,
  ]);

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
        {...(annotateEnabled
          ? {
              menuItems: [...RICH_DOCUMENT_ANNOTATE_MENU_ITEMS],
              onCustomMenuSelection: handleCustomMenuSelection,
            }
          : {})}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1, minHeight: 0},
});
