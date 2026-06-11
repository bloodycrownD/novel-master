/**
 * Markdown file preview with Front Matter card and themed body rendering.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {splitMarkdownFrontMatter} from '@novel-master/core/front-matter';
import type {ThemeTokens} from '../../theme/tokens';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {
  defaultVfsMarkdownPreviewEngine,
  readVfsMarkdownPreviewEngine,
  type VfsMarkdownPreviewEngine,
} from '../../storage/vfs-markdown-preview-engine';
import {RichContentBody} from '../rich-content/RichContentBody';
import {prepareTranscriptRichHtml} from '../rich-content/prepare-transcript-rich-html';
import {isRichContentOverLimit} from '../rich-content/rich-content-limits';
import {buildFrontMatterDocumentHtml} from './build-front-matter-document-html';
import {parseFrontMatterFields} from './front-matter-fields';
import {RichDocumentWebView} from './RichDocumentWebView';

const MARKDOWN_PATH = /\.(md|markdown)$/i;

export function isMarkdownPreviewPath(path: string): boolean {
  return MARKDOWN_PATH.test(path);
}

export type PreviewRenderKind = 'markdown' | 'txt';

interface FileMarkdownPreviewProps {
  path: string;
  content: string;
  tokens: ThemeTokens;
  /** When true, WebView body expands (flex:1) — caller must not wrap WebView in ScrollView. */
  previewFill?: boolean;
  /** Tab selection: 'txt' shows raw source; 'markdown' runs the preview pipeline. */
  renderKind?: PreviewRenderKind;
}

/** Wrap plain/RN markdown in ScrollView when previewFill — WebView paths skip this. */
function PreviewScrollWrap({
  previewFill,
  children,
}: {
  previewFill: boolean;
  children: React.ReactNode;
}) {
  if (!previewFill) {
    return <>{children}</>;
  }
  return (
    <ScrollView
      style={styles.rnBodyScroll}
      contentContainerStyle={styles.rnBodyContent}
      keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function FileMarkdownPreview({
  path,
  content,
  tokens,
  previewFill = false,
  renderKind = 'markdown',
}: FileMarkdownPreviewProps) {
  const {appUi} = useNovelMaster();
  const [previewEngine, setPreviewEngine] = useState<VfsMarkdownPreviewEngine>(
    defaultVfsMarkdownPreviewEngine(),
  );

  const refreshPreviewEngine = useCallback(async () => {
    setPreviewEngine(await readVfsMarkdownPreviewEngine(appUi));
  }, [appUi]);

  useEffect(() => {
    refreshPreviewEngine().catch(() => undefined);
  }, [refreshPreviewEngine]);

  useFocusEffect(
    useCallback(() => {
      refreshPreviewEngine().catch(() => undefined);
    }, [refreshPreviewEngine]),
  );

  const isMdPath = isMarkdownPreviewPath(path);
  const split = useMemo(
    () => (isMdPath ? splitMarkdownFrontMatter(content) : null),
    [content, isMdPath],
  );

  const fmLines = split?.frontMatterLines ?? null;
  const showFrontMatter = isMdPath && fmLines !== null;
  const fmFields =
    showFrontMatter && split?.closed
      ? parseFrontMatterFields(fmLines)
      : [];
  const mdBody =
    isMdPath && split?.closed ? (split.body ?? '').trim() : '';

  // Non-md + Markdown Tab: full file as body (no front-matter split).
  const nonMdBody = useMemo(
    () => (!isMdPath ? content.trim() : ''),
    [content, isMdPath],
  );

  const mdOverLimit = isRichContentOverLimit(mdBody);
  const nonMdOverLimit = isRichContentOverLimit(nonMdBody);

  const mdBodyHtml = useMemo(() => {
    if (!mdBody || mdOverLimit || previewEngine !== 'webview') {
      return undefined;
    }
    try {
      return prepareTranscriptRichHtml(mdBody);
    } catch {
      return undefined;
    }
  }, [mdBody, mdOverLimit, previewEngine]);

  const nonMdBodyHtml = useMemo(() => {
    if (!nonMdBody || nonMdOverLimit || previewEngine !== 'webview') {
      return undefined;
    }
    try {
      return prepareTranscriptRichHtml(nonMdBody);
    } catch {
      return undefined;
    }
  }, [nonMdBody, nonMdOverLimit, previewEngine]);

  const mdUseWebViewPreview =
    previewEngine === 'webview' &&
    isMdPath &&
    split?.closed === true &&
    (mdBody.length > 0 || showFrontMatter);

  const nonMdUseWebViewPreview =
    previewEngine === 'webview' && !isMdPath && nonMdBody.length > 0;

  const frontMatterHtml = useMemo(() => {
    if (!mdUseWebViewPreview || !showFrontMatter) {
      return undefined;
    }
    return buildFrontMatterDocumentHtml({
      fields: fmFields,
      invalid: !split?.closed,
      empty: split?.closed === true && fmLines.length === 0,
      rawLines: !split?.closed ? fmLines : undefined,
    });
  }, [
    mdUseWebViewPreview,
    showFrontMatter,
    fmFields,
    split?.closed,
    fmLines,
  ]);

  if (!content.trim()) {
    return (
      <Text style={[styles.empty, {color: tokens.textSecondary}]}>
        （空文件）
      </Text>
    );
  }

  // renderKind drives tab: txt shows raw source for all file types.
  if (renderKind === 'txt') {
    const plain = (
      <Text style={[styles.plain, {color: tokens.text}]}>{content}</Text>
    );
    return (
      <PreviewScrollWrap previewFill={previewFill}>{plain}</PreviewScrollWrap>
    );
  }

  // Non-md Markdown Tab: render full content as markdown body (no FM split).
  if (!isMdPath) {
    return (
      <View
        style={[
          styles.root,
          previewFill && nonMdUseWebViewPreview && styles.fillRoot,
        ]}>
        {nonMdUseWebViewPreview ? (
          <RichDocumentWebView
            html={nonMdBodyHtml}
            plain={nonMdBody}
            overLimit={nonMdOverLimit}
            style={previewFill ? styles.webBody : undefined}
          />
        ) : nonMdBody ? (
          <PreviewScrollWrap previewFill={previewFill}>
            <RichContentBody
              content={nonMdBody}
              tokens={tokens}
              variant="file-preview"
            />
          </PreviewScrollWrap>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.root, previewFill && mdUseWebViewPreview && styles.fillRoot]}>
      {!split?.closed ? (
        <Text style={{color: tokens.textSecondary, fontSize: 14}}>
          请返回编辑并补全结束的 --- 后再预览正文。
        </Text>
      ) : null}
      {mdUseWebViewPreview ? (
        <RichDocumentWebView
          html={mdBodyHtml}
          plain={mdBody}
          overLimit={mdOverLimit}
          frontMatterHtml={frontMatterHtml}
          style={previewFill ? styles.webBody : undefined}
        />
      ) : mdBody ? (
        <>
          {showFrontMatter ? (
            <FrontMatterCard
              tokens={tokens}
              fields={fmFields}
              invalid={!split?.closed}
              empty={split?.closed === true && fmLines.length === 0}
              rawLines={!split?.closed ? fmLines : undefined}
            />
          ) : null}
          <PreviewScrollWrap previewFill={previewFill}>
            <RichContentBody
              content={mdBody}
              tokens={tokens}
              variant="file-preview"
            />
          </PreviewScrollWrap>
        </>
      ) : split?.closed && showFrontMatter ? (
        <>
          <FrontMatterCard
            tokens={tokens}
            fields={fmFields}
            invalid={false}
            empty={fmLines.length === 0}
          />
          <Text style={{color: tokens.textSecondary, fontSize: 14}}>
            （正文为空）
          </Text>
        </>
      ) : null}
    </View>
  );
}

interface FrontMatterCardProps {
  tokens: ThemeTokens;
  fields: {key: string; value: string}[];
  invalid: boolean;
  empty: boolean;
  rawLines?: string[];
}

function FrontMatterCard({
  tokens,
  fields,
  invalid,
  empty,
  rawLines,
}: FrontMatterCardProps) {
  return (
    <View
      style={[
        styles.fmCard,
        {
          backgroundColor: tokens.bgSecondary,
          borderColor: tokens.border,
        },
      ]}>
      <Text style={[styles.fmTitle, {color: tokens.textSecondary}]}>
        Front Matter
      </Text>
      {invalid ? (
        <Text style={[styles.fmError, {color: tokens.danger}]}>
          格式无效：缺少结束的 --- 分隔线
        </Text>
      ) : null}
      {empty ? (
        <Text style={{color: tokens.textSecondary, fontSize: 13}}>
          （空 Front Matter）
        </Text>
      ) : null}
      {!invalid && !empty
        ? fields.map((field, index) => (
            <View key={`${field.key}-${index}`} style={styles.fmRow}>
              {field.key ? (
                <Text
                  style={[styles.fmKey, {color: tokens.textSecondary}]}
                  numberOfLines={1}>
                  {field.key}
                </Text>
              ) : null}
              <Text style={[styles.fmValue, {color: tokens.text}]}>
                {field.value}
              </Text>
            </View>
          ))
        : null}
      {invalid && rawLines?.length
        ? rawLines.map((line, index) => (
            <Text
              key={index}
              style={[styles.fmValue, {color: tokens.text, fontFamily: 'monospace'}]}>
              {line}
            </Text>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {gap: 16},
  fillRoot: {flex: 1, minHeight: 0},
  webBody: {flex: 1, minHeight: 0},
  rnBodyScroll: {flex: 1, minHeight: 0},
  rnBodyContent: {flexGrow: 1},
  empty: {fontSize: 14},
  plain: {fontFamily: 'monospace', fontSize: 14, lineHeight: 20},
  fmCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  fmTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fmError: {fontSize: 13},
  fmRow: {gap: 2},
  fmKey: {fontSize: 12, fontWeight: '500'},
  fmValue: {fontSize: 15, lineHeight: 21},
});
