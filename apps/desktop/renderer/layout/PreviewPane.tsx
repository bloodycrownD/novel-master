import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "../components/ui/Button";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { CodeEditor } from "../components/ui/CodeEditor";
import { ipcVfsRead, ipcVfsWrite, vfsScope } from "../ipc/client";
import { showToast } from "../components/ui/show-toast";
import { formatVfsErrorForUser, type VfsScope } from "@novel-master/core/vfs";
import type { AnnotateDraft } from "@novel-master/core/chat";
import type { WorkspacePanelScope } from "@shared/ipc-types";
import { useShellNav } from "../providers/ShellNavProvider";
import {
  listChatAnnotateDrafts,
  subscribeChatAnnotateDraft,
} from "../features/chat/chat-annotate-draft";
import { PreviewEditorTabs } from "./PreviewEditorTabs";
import { shouldRenderMarkdownPreview } from "./preview-utils";
import {
  applyAnnotateHighlights,
  getSelectionFloatingAnchor,
  isPreviewAnnotateEnabled,
  parseAnnotateIdsAttr,
  PREVIEW_ANNOTATE_IDS_ATTR,
  PREVIEW_ANNOTATE_MARK_CLASS,
  readSelectionTextInContainer,
} from "./preview-annotate";
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
  const [saving, setSaving] = useState(false);
  const [fileMissing, setFileMissing] = useState(false);
  const [annotateDrafts, setAnnotateDrafts] = useState<readonly AnnotateDraft[]>(
    () => listChatAnnotateDrafts(sessionId),
  );
  const [floating, setFloating] = useState<{
    top: number;
    left: number;
    text: string;
  } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState("");
  const [detailDraft, setDetailDraft] = useState<AnnotateDraft | null>(null);
  const [pickDrafts, setPickDrafts] = useState<AnnotateDraft[] | null>(null);
  const previewContentRef = useRef<HTMLDivElement | null>(null);

  const annotateEnabled = isPreviewAnnotateEnabled(
    mode,
    previewFile?.workspaceScope,
    sessionId,
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
    }
  }, [annotateEnabled]);

  const refreshSelectionFloating = useCallback(() => {
    if (!annotateEnabled) {
      setFloating(null);
      return;
    }
    const root = previewContentRef.current;
    const text = readSelectionTextInContainer(root);
    if (text == null) {
      setFloating(null);
      return;
    }
    const anchor = getSelectionFloatingAnchor();
    if (anchor == null) {
      setFloating(null);
      return;
    }
    setFloating({ top: anchor.top, left: anchor.left, text });
  }, [annotateEnabled]);

  useEffect(() => {
    if (!annotateEnabled) {
      return;
    }
    let timer: number | undefined;
    const scheduleRefresh = (delayMs: number) => {
      if (timer != null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        timer = undefined;
        refreshSelectionFloating();
      }, delayMs);
    };
    const onMouseUp = () => scheduleRefresh(0);
    const onKeyUp = () => scheduleRefresh(0);
    const onSelectionChange = () => scheduleRefresh(50);
    const onContextMenu = () => {
      const root = previewContentRef.current;
      if (root == null) {
        return;
      }
      const text = readSelectionTextInContainer(root);
      if (text == null) {
        return;
      }
      // 有有效选区时刷新浮动条；不 preventDefault，保留系统复制菜单
      scheduleRefresh(0);
    };
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      if (timer != null) {
        window.clearTimeout(timer);
      }
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, [annotateEnabled, refreshSelectionFloating]);

  useLayoutEffect(() => {
    const root = previewContentRef.current;
    if (root == null || !annotateEnabled) {
      return;
    }
    applyAnnotateHighlights(root, pathDrafts);
  }, [annotateEnabled, pathDrafts, content, loading]);

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

  const onPreviewClick = useCallback(
    (e: ReactMouseEvent) => {
      if (!annotateEnabled) {
        return;
      }
      const target = e.target;
      if (!(target instanceof Element)) {
        return;
      }
      const mark = target.closest(`mark.${PREVIEW_ANNOTATE_MARK_CLASS}`);
      if (mark == null) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const ids = parseAnnotateIdsAttr(
        mark.getAttribute(PREVIEW_ANNOTATE_IDS_ATTR),
      );
      openDraftsByIds(ids);
      setFloating(null);
    },
    [annotateEnabled, openDraftsByIds],
  );

  const isDirty = content !== savedContent;
  const isMarkdown =
    previewFile != null
      ? shouldRenderMarkdownPreview(previewFile.path, content)
      : false;
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
          <div
            className="preview-body"
            id="preview-body"
            ref={previewContentRef}
            onClick={onPreviewClick}
          >
            {isMarkdown ? (
              <div className="preview-markdown">
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
            setPendingSelection(floating.text);
            setAddOpen(true);
            setFloating(null);
            window.getSelection()?.removeAllRanges();
          }}
        />
      ) : null}
      {annotateEnabled && previewFile != null && sessionId ? (
        <PreviewAnnotateAddModal
          open={addOpen}
          selectedText={pendingSelection}
          sessionId={sessionId}
          filePath={previewFile.path}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
      {annotateEnabled && sessionId ? (
        <PreviewAnnotateDetailModal
          open={detailDraft != null}
          draft={detailDraft}
          sessionId={sessionId}
          onClose={() => setDetailDraft(null)}
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
          onClose={() => setPickDrafts(null)}
        />
      ) : null}
    </>
  );
}
