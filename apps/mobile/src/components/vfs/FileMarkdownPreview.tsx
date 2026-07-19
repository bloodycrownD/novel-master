/**
 * Markdown file preview with Front Matter card and themed body rendering.
 * 划词批注：仅 annotateEnabled（session 预览态）经 WebView 桥接入。
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {splitMarkdownFrontMatter} from '@novel-master/core/worktree';
import type {AnnotateDraft} from '@novel-master/core/chat';
import type {ThemeTokens} from '../../theme/tokens';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {
  defaultVfsMarkdownPreviewEngine,
  readVfsMarkdownPreviewEngine,
  type VfsMarkdownPreviewEngine,
} from '../../storage/vfs-markdown-preview-engine';
import {
  addChatAnnotateDraft,
  listChatAnnotateDrafts,
  removeChatAnnotateDraft,
  subscribeChatAnnotateDraft,
  updateChatAnnotateDraft,
} from '../../storage/chat-annotate-draft';
import {refreshComposerAnnotateChips} from '../../storage/chat-composer-draft';
import {RichContentBody} from '../rich-content/RichContentBody';
import {prepareTranscriptRichHtml} from '../rich-content/prepare-transcript-rich-html';
import {isRichContentOverLimit} from '../rich-content/rich-content-limits';
import {MessageEditModal} from '../chat/MessageEditModal';
import {buildFrontMatterDocumentHtml} from './build-front-matter-document-html';
import {parseFrontMatterFields} from './front-matter-fields';
import type {RichDocumentAnnotationMark} from './RichDocumentBridge';
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
  /**
   * 划词批注入口。仅 FileEditorScreen 在 previewMode && scopeKind==="session" 时打开。
   * project/global/编辑态必须为 false。
   */
  annotateEnabled?: boolean;
  /** annotateEnabled 时必填：写入 chat-annotate-draft 会话 Map。 */
  sessionId?: string;
}

function newAnnotateId(): string {
  return `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
  annotateEnabled = false,
  sessionId,
}: FileMarkdownPreviewProps) {
  const {appUi} = useNovelMaster();
  const [previewEngine, setPreviewEngine] = useState<VfsMarkdownPreviewEngine>(
    defaultVfsMarkdownPreviewEngine(),
  );
  const [pathDrafts, setPathDrafts] = useState<AnnotateDraft[]>([]);
  const [addVisible, setAddVisible] = useState(false);
  const [pendingOriginalText, setPendingOriginalText] = useState('');
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailDraft, setDetailDraft] = useState<AnnotateDraft | null>(null);
  const [editVisible, setEditVisible] = useState(false);
  const [editingDraft, setEditingDraft] = useState<AnnotateDraft | null>(null);

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

  const syncPathDrafts = useCallback(() => {
    if (!annotateEnabled || sessionId == null || sessionId === '') {
      setPathDrafts([]);
      return;
    }
    setPathDrafts(
      listChatAnnotateDrafts(sessionId).filter(d => d.path === path),
    );
  }, [annotateEnabled, sessionId, path]);

  useEffect(() => {
    syncPathDrafts();
    if (!annotateEnabled || sessionId == null || sessionId === '') {
      return;
    }
    return subscribeChatAnnotateDraft(changed => {
      if (changed === sessionId) {
        syncPathDrafts();
      }
    });
  }, [annotateEnabled, sessionId, syncPathDrafts]);

  const annotationMarks: readonly RichDocumentAnnotationMark[] = useMemo(
    () =>
      pathDrafts.map(d => ({
        id: d.id,
        originalText: d.originalText,
      })),
    [pathDrafts],
  );

  const handleSelectionAnnotate = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    setPendingOriginalText(trimmed);
    setAddVisible(true);
  }, []);

  const handleAddConfirm = useCallback(
    async (userAnnotation: string) => {
      if (!annotateEnabled || sessionId == null || sessionId === '') {
        return;
      }
      addChatAnnotateDraft(sessionId, {
        id: newAnnotateId(),
        path,
        originalText: pendingOriginalText,
        userAnnotation,
      });
      refreshComposerAnnotateChips(sessionId);
    },
    [annotateEnabled, sessionId, path, pendingOriginalText],
  );

  const handleAnnotateOpen = useCallback(
    (id: string) => {
      const draft = pathDrafts.find(d => d.id === id);
      if (!draft) {
        return;
      }
      setDetailDraft(draft);
      setDetailVisible(true);
    },
    [pathDrafts],
  );

  const handleDetailDelete = useCallback(() => {
    if (!sessionId || !detailDraft) {
      return;
    }
    removeChatAnnotateDraft(sessionId, detailDraft.id);
    refreshComposerAnnotateChips(sessionId);
    setDetailVisible(false);
    setDetailDraft(null);
  }, [sessionId, detailDraft]);

  const handleDetailEdit = useCallback(() => {
    if (!detailDraft) {
      return;
    }
    setEditingDraft(detailDraft);
    setDetailVisible(false);
    setEditVisible(true);
  }, [detailDraft]);

  const handleEditConfirm = useCallback(
    async (userAnnotation: string) => {
      if (!sessionId || !editingDraft) {
        return;
      }
      updateChatAnnotateDraft(sessionId, editingDraft.id, {userAnnotation});
      refreshComposerAnnotateChips(sessionId);
      setEditingDraft(null);
    },
    [sessionId, editingDraft],
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
  const plainOverLimit = isRichContentOverLimit(content);

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

  const annotateWebProps = annotateEnabled
    ? {
        annotateEnabled: true as const,
        annotations: annotationMarks,
        onSelectionAnnotate: handleSelectionAnnotate,
        onAnnotateOpen: handleAnnotateOpen,
      }
    : {annotateEnabled: false as const};

  const annotateModals = (
    <>
      <MessageEditModal
        visible={addVisible}
        title="批注"
        label={
          pendingOriginalText.length > 80
            ? `${pendingOriginalText.slice(0, 80)}…`
            : pendingOriginalText
        }
        placeholder="批注说明"
        confirmLabel="添加"
        onClose={() => setAddVisible(false)}
        onConfirm={handleAddConfirm}
      />
      <MessageEditModal
        visible={detailVisible}
        title="批注"
        initialValue={detailDraft?.userAnnotation ?? ''}
        readOnly
        onClose={() => {
          setDetailVisible(false);
          setDetailDraft(null);
        }}
        onEdit={handleDetailEdit}
        onDelete={handleDetailDelete}
      />
      <MessageEditModal
        visible={editVisible}
        title="编辑批注"
        label={
          editingDraft && editingDraft.originalText.length > 80
            ? `${editingDraft.originalText.slice(0, 80)}…`
            : editingDraft?.originalText
        }
        placeholder="批注说明"
        initialValue={editingDraft?.userAnnotation ?? ''}
        confirmLabel="保存"
        onClose={() => {
          setEditVisible(false);
          setEditingDraft(null);
        }}
        onConfirm={handleEditConfirm}
      />
    </>
  );

  if (!content.trim()) {
    return (
      <Text style={[styles.empty, {color: tokens.textSecondary}]}>
        （空文件）
      </Text>
    );
  }

  // renderKind drives tab: txt shows raw source for all file types.
  // 划词批注开启时走 WebView plain，以便选区/下划线（md/txt 同验收）。
  if (renderKind === 'txt') {
    if (annotateEnabled) {
      return (
        <View style={[styles.root, previewFill && styles.fillRoot]}>
          <RichDocumentWebView
            plain={content}
            overLimit={plainOverLimit}
            style={previewFill ? styles.webBody : undefined}
            {...annotateWebProps}
          />
          {annotateModals}
        </View>
      );
    }
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
          previewFill && annotateEnabled && styles.fillRoot,
        ]}>
        {nonMdUseWebViewPreview || annotateEnabled ? (
          <RichDocumentWebView
            html={nonMdBodyHtml}
            plain={nonMdBody}
            overLimit={nonMdOverLimit}
            style={previewFill ? styles.webBody : undefined}
            {...annotateWebProps}
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
        {annotateEnabled ? annotateModals : null}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.root,
        previewFill && mdUseWebViewPreview && styles.fillRoot,
        previewFill && annotateEnabled && styles.fillRoot,
      ]}>
      {!split?.closed ? (
        <Text style={{color: tokens.textSecondary, fontSize: 14}}>
          请返回编辑并补全结束的 --- 后再预览正文。
        </Text>
      ) : null}
      {mdUseWebViewPreview || (annotateEnabled && split?.closed) ? (
        <RichDocumentWebView
          html={mdBodyHtml}
          plain={mdBody || content}
          overLimit={mdOverLimit}
          frontMatterHtml={frontMatterHtml}
          style={previewFill ? styles.webBody : undefined}
          {...annotateWebProps}
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
      {annotateEnabled ? annotateModals : null}
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
