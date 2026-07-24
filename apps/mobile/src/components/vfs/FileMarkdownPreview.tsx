/**
 * Markdown file preview with Front Matter card and themed body rendering.
 * 划词批注：仅 MD Tab + annotateEnabled；干净 HTML setDocument 后 WebView 内 Recogito。
 * plain/文本 Tab：禁用批注入口与投影。
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {splitMarkdownFrontMatter} from '@novel-master/core/workplace';
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
import type {
  RichDocumentAnnotationMark,
  RichDocumentRecogitoCreatePayload,
} from './RichDocumentBridge';
import {AnnotatePickModal} from './AnnotatePickModal';
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
   * project/global/编辑态必须为 false。plain Tab 即使为 true 也不挂 Recogito。
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

/** 仅成对 renderStart/renderEnd 的草稿可投影（R8）。 */
export function pathDraftsToRecogitoMarks(
  drafts: readonly AnnotateDraft[],
): RichDocumentAnnotationMark[] {
  const out: RichDocumentAnnotationMark[] = [];
  for (const d of drafts) {
    if (
      typeof d.renderStart !== 'number' ||
      typeof d.renderEnd !== 'number' ||
      d.renderStart < 0 ||
      d.renderEnd <= d.renderStart
    ) {
      continue;
    }
    out.push({
      id: d.id,
      originalText: d.originalText,
      renderStart: d.renderStart,
      renderEnd: d.renderEnd,
    });
  }
  return out;
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
  /** store 变更时递增，驱动 pathDrafts 同步重算（禁止仅靠滞后 useEffect 派生）。 */
  const [draftTick, setDraftTick] = useState(0);
  const [clearAnnotateSelectionSignal, setClearAnnotateSelectionSignal] =
    useState(0);
  const [addVisible, setAddVisible] = useState(false);
  const [pendingOriginalText, setPendingOriginalText] = useState('');
  const [pendingRenderRange, setPendingRenderRange] = useState<{
    renderStart: number;
    renderEnd: number;
  } | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailDraft, setDetailDraft] = useState<AnnotateDraft | null>(null);
  const [editVisible, setEditVisible] = useState(false);
  const [editingDraft, setEditingDraft] = useState<AnnotateDraft | null>(null);
  const [pickDrafts, setPickDrafts] = useState<AnnotateDraft[] | null>(null);

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

  /**
   * path/session 变化时在 render 期同步派生当前文件草稿。
   * 避免 useEffect 滞后一帧导致新 path 错配旧 path 的 annotations。
   */
  const pathDrafts = useMemo((): AnnotateDraft[] => {
    if (!annotateEnabled || sessionId == null || sessionId === '') {
      return [];
    }
    return listChatAnnotateDrafts(sessionId).filter(d => d.path === path);
  }, [annotateEnabled, sessionId, path, draftTick]);

  const recogitoMarks = useMemo(
    () => pathDraftsToRecogitoMarks(pathDrafts),
    [pathDrafts],
  );

  useEffect(() => {
    if (!annotateEnabled || sessionId == null || sessionId === '') {
      return;
    }
    return subscribeChatAnnotateDraft(changed => {
      if (changed === sessionId) {
        setDraftTick(t => t + 1);
      }
    });
  }, [annotateEnabled, sessionId]);

  const handleRecogitoCreate = useCallback(
    (payload: RichDocumentRecogitoCreatePayload) => {
      // 采集侧已 trim（策略 b）；此处勿二次 trim，以免与 renderStart/End 错位
      const quote = payload.quote;
      if (!quote) {
        return;
      }
      setPendingOriginalText(quote);
      setPendingRenderRange({
        renderStart: payload.renderStart,
        renderEnd: payload.renderEnd,
      });
      setAddVisible(true);
    },
    [],
  );

  const handleAddConfirm = useCallback(
    async (userAnnotation: string) => {
      if (!annotateEnabled || sessionId == null || sessionId === '') {
        return;
      }
      const range = pendingRenderRange;
      addChatAnnotateDraft(sessionId, {
        id: newAnnotateId(),
        path,
        originalText: pendingOriginalText,
        userAnnotation,
        ...(range
          ? {
              renderStart: range.renderStart,
              renderEnd: range.renderEnd,
            }
          : {}),
      });
      refreshComposerAnnotateChips(sessionId);
      setPendingRenderRange(null);
    },
    [
      annotateEnabled,
      sessionId,
      path,
      pendingOriginalText,
      pendingRenderRange,
    ],
  );

  const handleAnnotateOpen = useCallback(
    (ids: readonly string[]) => {
      const matched = pathDrafts.filter(d => ids.includes(d.id));
      if (matched.length === 0) {
        return;
      }
      if (matched.length === 1) {
        setDetailDraft(matched[0]!);
        setDetailVisible(true);
        return;
      }
      setPickDrafts(matched);
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

  /** 干净 MD 正文（禁止源串插锚注再渲染）。 */
  const mdBody = useMemo(() => {
    return isMdPath && split?.closed ? (split.body ?? '').trim() : '';
  }, [isMdPath, split?.closed, split?.body]);

  // Non-md + Markdown Tab: full file as body (no front-matter split).
  const nonMdBody = useMemo(() => {
    if (!isMdPath) {
      return content.trim();
    }
    return '';
  }, [isMdPath, content]);

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

  /** 仅 MD Tab 挂 Recogito；plain 永不 annotate。 */
  const mdAnnotateActive = annotateEnabled === true && renderKind === 'markdown';

  const bumpClearAnnotateSelection = useCallback(() => {
    setClearAnnotateSelectionSignal(n => n + 1);
  }, []);

  const annotateWebProps = mdAnnotateActive
    ? {
        annotateEnabled: true as const,
        annotations: recogitoMarks,
        onRecogitoCreate: handleRecogitoCreate,
        onAnnotateOpen: handleAnnotateOpen,
        clearAnnotateSelectionSignal,
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
        onClose={() => {
          setAddVisible(false);
          setPendingRenderRange(null);
          // 取消时靠 draftTick / setAnnotations 清掉 Recogito 临时高亮（无新稿）
          setDraftTick(t => t + 1);
          bumpClearAnnotateSelection();
        }}
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
          bumpClearAnnotateSelection();
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
          bumpClearAnnotateSelection();
        }}
        onConfirm={handleEditConfirm}
      />
      <AnnotatePickModal
        visible={pickDrafts != null}
        drafts={pickDrafts ?? []}
        onPick={d => {
          setPickDrafts(null);
          setDetailDraft(d);
          setDetailVisible(true);
        }}
        onClose={() => {
          setPickDrafts(null);
          bumpClearAnnotateSelection();
        }}
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

  // plain/文本 Tab：禁用批注（无 WebView annotate / 无 Recogito / 无菜单）
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
          previewFill && mdAnnotateActive && styles.fillRoot,
        ]}>
        {nonMdUseWebViewPreview || mdAnnotateActive ? (
          <RichDocumentWebView
            key={path}
            html={nonMdBodyHtml}
            plain={content.trim()}
            overLimit={nonMdOverLimit}
            style={previewFill ? styles.webBody : undefined}
            {...annotateWebProps}
          />
        ) : content.trim() ? (
          <PreviewScrollWrap previewFill={previewFill}>
            <RichContentBody
              content={content.trim()}
              tokens={tokens}
              variant="file-preview"
            />
          </PreviewScrollWrap>
        ) : null}
        {mdAnnotateActive ? annotateModals : null}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.root,
        previewFill && mdUseWebViewPreview && styles.fillRoot,
        previewFill && mdAnnotateActive && styles.fillRoot,
      ]}>
      {!split?.closed ? (
        <Text style={{color: tokens.textSecondary, fontSize: 14}}>
          请返回编辑并补全结束的 --- 后再预览正文。
        </Text>
      ) : null}
      {mdUseWebViewPreview || (mdAnnotateActive && split?.closed) ? (
        <RichDocumentWebView
          key={path}
          html={mdBodyHtml}
          plain={(split?.body ?? '').trim() || content}
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
              content={(split?.body ?? '').trim() || content}
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
      {mdAnnotateActive ? annotateModals : null}
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
