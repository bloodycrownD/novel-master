import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  createTextAnnotator,
  type TextAnnotator,
  type TextAnnotation,
} from "@recogito/text-annotator";
import "@recogito/text-annotator/text-annotator.css";
import { Button } from "../components/ui/Button";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { CodeEditor } from "../components/ui/CodeEditor";
import { ipcVfsRead, ipcVfsWrite, vfsScope } from "../ipc/client";
import { showToast } from "../components/ui/show-toast";
import { formatVfsErrorForUser, type VfsScope } from "@shared/logic/vfs";
import type { AnnotateDraft } from "@shared/logic/chat";
import type { WorkspacePanelScope } from "@shared/ipc-types";
import { useShellNav } from "../providers/ShellNavProvider";
import {
  listChatAnnotateDrafts,
  subscribeChatAnnotateDraft,
} from "../features/chat/chat-annotate-draft";
import { PreviewEditorTabs } from "./PreviewEditorTabs";
import { shouldRenderMarkdownPreview } from "./preview-utils";
import {
  getSelectionFloatingAnchor,
  isPreviewAnnotateEnabled,
} from "./preview-annotate";
import {
  draftsToRecogitoAnnotations,
  getSelectionOffsetsInElement,
} from "./preview-recogito";
import {
  PreviewAnnotateAddModal,
  PreviewAnnotateDetailModal,
  PreviewAnnotateFloatingBar,
  PreviewAnnotatePickModal,
} from "./PreviewAnnotateUi";

function toCoreVfsScope(
  workspaceScope: WorkspacePanelScope,
  projectId: string,
  sessionId: string,
): VfsScope {
  switch (workspaceScope) {
    case "chat":
      return { kind: "session", projectId, sessionId };
    case "session":
      return { kind: "project", projectId };
    case "global":
      return { kind: "global" };
  }
}

export function PreviewPane() {
  const {
    previewFile,
    projectId,
    sessionId,
    treeRefreshToken,
    notifyWorkspaceMutated,
  } = useShellNav();
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [version, setVersion] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [fileMissing, setFileMissing] = useState(false);
  const [annotateDrafts, setAnnotateDrafts] = useState<readonly AnnotateDraft[]>(
    () => listChatAnnotateDrafts(sessionId),
  );
  const [floating, setFloating] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState("");
  const [pendingRenderStart, setPendingRenderStart] = useState<number | null>(
    null,
  );
  const [pendingRenderEnd, setPendingRenderEnd] = useState<number | null>(null);
  const [detailDraft, setDetailDraft] = useState<AnnotateDraft | null>(null);
  const [pickDrafts, setPickDrafts] = useState<AnnotateDraft[] | null>(null);
  const [saving, setSaving] = useState(false);
  const mdRootRef = useRef<HTMLDivElement | null>(null);
  const annotatorRef = useRef<TextAnnotator | null>(null);

  const isMarkdown =
    previewFile != null
      ? shouldRenderMarkdownPreview(previewFile.path, content)
      : false;

  const annotateEnabled = isPreviewAnnotateEnabled(
    mode,
    previewFile?.workspaceScope,
    sessionId,
    isMarkdown,
  );

  const pathDrafts = useMemo(() => {
    if (!annotateEnabled || previewFile == null) {
      return [] as AnnotateDraft[];
    }
    return annotateDrafts.filter((d) => d.path === previewFile.path);
  }, [annotateEnabled, annotateDrafts, previewFile]);

  useEffect(() => {
    setAnnotateDrafts(listChatAnnotateDrafts(sessionId));
    return subscribeChatAnnotateDraft((changed) => {
      if (changed === sessionId) {
        setAnnotateDrafts(listChatAnnotateDrafts(sessionId));
      }
    });
  }, [sessionId]);

  const loadFile = useCallback(async () => {
    if (!previewFile) {
      setContent("");
      setSavedContent("");
      setVersion(undefined);
      setFileMissing(false);
      return;
    }
    if (previewFile.isDeleted) {
      setFileMissing(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFileMissing(false);
    try {
      const result = await ipcVfsRead({
        ...vfsScope(
          previewFile.workspaceScope,
          projectId,
          sessionId,
        ),
        path: previewFile.path,
      });
      if (result.ok) {
        setContent(result.data.content);
        setSavedContent(result.data.content);
        setVersion(result.data.version);
        setFileMissing(false);
      } else if (result.error.code === "NOT_FOUND") {
        setFileMissing(true);
      }
    } finally {
      setLoading(false);
    }
  }, [previewFile, projectId, sessionId]);

  useEffect(() => {
    void loadFile();
    setMode("read");
  }, [loadFile]);

  useEffect(() => {
    if (previewFile && !previewFile.isDeleted) {
      void loadFile();
    }
  }, [treeRefreshToken, previewFile, loadFile]);

  useEffect(() => {
    if (!annotateEnabled) {
      setFloating(null);
      setAddOpen(false);
      setDetailDraft(null);
      setPickDrafts(null);
      setPendingSelection("");
      setPendingRenderStart(null);
      setPendingRenderEnd(null);
    }
  }, [annotateEnabled]);

  const openDraftsByIds = useCallback(
    (ids: readonly string[]) => {
      const matched = pathDrafts.filter((d) => ids.includes(d.id));
      if (matched.length === 0) {
        return;
      }
      if (matched.length === 1) {
        setDetailDraft(matched[0]!);
        return;
      }
      setPickDrafts(matched);
    },
    [pathDrafts],
  );

  const openDraftsByIdsRef = useRef(openDraftsByIds);
  openDraftsByIdsRef.current = openDraftsByIds;
  const pathDraftsRef = useRef(pathDrafts);
  pathDraftsRef.current = pathDrafts;

  const clearAnnotateSelection = useCallback(() => {
    try {
      annotatorRef.current?.cancelSelected();
    } catch {
      // 宿主差异忽略
    }
  }, []);

  // MD 预览根挂 Recogito（仅投影）；划词新建不走 createAnnotation，避免选区变蓝
  useEffect(() => {
    if (!annotateEnabled || loading || !isMarkdown) {
      if (annotatorRef.current != null) {
        annotatorRef.current.destroy();
        annotatorRef.current = null;
      }
      return;
    }
    const el = mdRootRef.current;
    if (el == null) {
      return;
    }

    const anno = createTextAnnotator(el, {
      annotatingEnabled: false,
      style: {
        fill: "transparent",
        fillOpacity: 0,
        underlineStyle: "solid",
        underlineThickness: 2,
        underlineOffset: 1,
      },
    });
    annotatorRef.current = anno;

    const onSelectionChanged = (selected: TextAnnotation[]) => {
      if (selected.length === 0) {
        return;
      }
      const draftIds = new Set(pathDraftsRef.current.map((d) => d.id));
      const known = selected
        .map((a) => a.id)
        .filter((id) => draftIds.has(id));
      if (known.length === 0) {
        return;
      }
      // 命中已入库 draft：只开详情，关掉添加弹层与浮动条
      setAddOpen(false);
      setFloating(null);
      openDraftsByIdsRef.current(known);
      // 立刻取消选中：否则二次点击同高亮常不触发 selectionChanged
      try {
        anno.cancelSelected();
      } catch {
        // ignore
      }
    };

    // mouseup 只更新 pending 选区 + 浮动条；禁止直开 AddModal（R6：显式批注、保留复制）
    const onMouseUp = () => {
      if (!annotateEnabled) {
        return;
      }
      const range = getSelectionOffsetsInElement(el);
      if (range == null) {
        setFloating(null);
        return;
      }
      const anchor = getSelectionFloatingAnchor();
      if (anchor == null) {
        setFloating(null);
        return;
      }
      setPendingSelection(range.quote);
      setPendingRenderStart(range.renderStart);
      setPendingRenderEnd(range.renderEnd);
      setFloating({ top: anchor.top, left: anchor.left });
    };

    anno.on("selectionChanged", onSelectionChanged);
    el.addEventListener("mouseup", onMouseUp);

    return () => {
      el.removeEventListener("mouseup", onMouseUp);
      anno.off("selectionChanged", onSelectionChanged);
      anno.destroy();
      if (annotatorRef.current === anno) {
        annotatorRef.current = null;
      }
    };
  }, [annotateEnabled, isMarkdown, loading, content, previewFile?.path]);

  // 草稿 → Recogito 投影；仅 renderStart/End 新稿（R4 / R8）
  useEffect(() => {
    const anno = annotatorRef.current;
    if (anno == null || !annotateEnabled) {
      return;
    }
    anno.setAnnotations(draftsToRecogitoAnnotations(pathDrafts));
  }, [annotateEnabled, pathDrafts]);

  const closeAddModal = useCallback(() => {
    setAddOpen(false);
    setPendingSelection("");
    setPendingRenderStart(null);
    setPendingRenderEnd(null);
  }, []);
  const isDirty = content !== savedContent;
  const lineCount = useMemo(
    () => (content.length === 0 ? 0 : content.split("\n").length),
    [content],
  );

  const save = async () => {
    if (!previewFile || !isDirty || fileMissing) {
      return;
    }
    setSaving(true);
    try {
      const result = await ipcVfsWrite({
        ...vfsScope(
          previewFile.workspaceScope,
          projectId,
          sessionId,
        ),
        path: previewFile.path,
        content,
        expectedVersion: version,
        versionCheck: version != null,
        lastKnownContent: savedContent,
      });
      if (result.ok) {
        setSavedContent(content);
        await loadFile();
        notifyWorkspaceMutated();
      } else {
        const scope = toCoreVfsScope(
          previewFile.workspaceScope,
          projectId,
          sessionId,
        );
        const msg = formatVfsErrorForUser(
          { code: result.error.code, message: result.error.message },
          scope,
        );
        showToast(`保存失败：${msg}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const showMissing = fileMissing || previewFile?.isDeleted;

  return (
    <>
      <header className="column-header" id="preview-header" aria-label="文件预览">
        <PreviewEditorTabs />
        <div className="column-header__actions">
          <SegmentedControl
            aria-label="预览模式"
            value={mode}
            options={[
              { value: "read", label: "预览" },
              { value: "edit", label: "编辑" },
            ]}
            onChange={setMode}
          />
          {previewFile && mode === "edit" && !showMissing ? (
            <Button
              variant="primary"
              disabled={!isDirty || saving}
              onClick={() => void save()}
            >
              {saving ? "保存中…" : "保存"}
            </Button>
          ) : null}
        </div>
      </header>
      <section id="preview-pane" aria-label="文件预览">
        {!previewFile ? (
          <div className="preview-body" id="preview-body">
            <p className="preview-empty">在工作区选择文件以预览</p>
          </div>
        ) : showMissing ? (
          <div className="preview-body" id="preview-body">
            <p className="preview-empty preview-empty--deleted">
              文件已删除或不存在
            </p>
          </div>
        ) : loading ? (
          <div className="preview-body" id="preview-body">
            <p className="preview-empty">加载中…</p>
          </div>
        ) : mode === "read" ? (
          <div className="preview-body" id="preview-body">
            {isMarkdown ? (
              <div className="preview-markdown" ref={mdRootRef}>
                <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
              </div>
            ) : (
              <pre className="preview-text">{content || "（空文件）"}</pre>
            )}
          </div>
        ) : (
          <div className="preview-editor-shell">
            <CodeEditor
              id="preview-editor"
              aria-label="文件编辑"
              value={content}
              languagePath={previewFile.path}
              onChange={setContent}
              onSave={() => void save()}
            />
            <div className="preview-editor-status">
              <span>{lineCount} 行</span>
              <div className="preview-editor-status__right">
                <span className="preview-editor-status__hint">Ctrl+S 保存</span>
                <span
                  className={
                    isDirty ? "preview-editor-status__dirty" : undefined
                  }
                >
                  {isDirty ? "未保存" : "已保存"}
                </span>
              </div>
            </div>
          </div>
        )}
      </section>
      {annotateEnabled && floating != null ? (
        <PreviewAnnotateFloatingBar
          top={floating.top}
          left={floating.left}
          onAdd={() => {
            setAddOpen(true);
            setFloating(null);
            setDetailDraft(null);
            setPickDrafts(null);
            window.getSelection()?.removeAllRanges();
          }}
        />
      ) : null}
      {annotateEnabled && previewFile != null && sessionId ? (
        <PreviewAnnotateAddModal
          open={addOpen}
          selectedText={pendingSelection}
          renderStart={pendingRenderStart}
          renderEnd={pendingRenderEnd}
          sessionId={sessionId}
          filePath={previewFile.path}
          onClose={closeAddModal}
        />
      ) : null}
      {annotateEnabled && sessionId ? (
        <PreviewAnnotateDetailModal
          open={detailDraft != null}
          draft={detailDraft}
          sessionId={sessionId}
          onClose={() => {
            setDetailDraft(null);
            clearAnnotateSelection();
          }}
        />
      ) : null}
      {annotateEnabled ? (
        <PreviewAnnotatePickModal
          open={pickDrafts != null}
          drafts={pickDrafts ?? []}
          onPick={(d) => {
            setPickDrafts(null);
            setDetailDraft(d);
          }}
          onClose={() => {
            setPickDrafts(null);
            clearAnnotateSelection();
          }}
        />
      ) : null}
    </>
  );
}
