import { useCallback, useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "../components/ui/Button";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { CodeEditor } from "../components/ui/CodeEditor";
import { ipcVfsRead, ipcVfsWrite, vfsScope } from "../ipc/client";
import { useShellNav } from "../providers/ShellNavProvider";
import { PreviewBreadcrumb } from "./PreviewBreadcrumb";
import { shouldRenderMarkdownPreview } from "./preview-utils";

export function PreviewPane() {
  const {
    previewFile,
    projectId,
    sessionId,
    refreshWorkspaceTrees,
    selectPreviewFile,
    requestTreeExpandPath,
  } = useShellNav();
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [version, setVersion] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadFile = useCallback(async () => {
    if (!previewFile) {
      setContent("");
      setSavedContent("");
      setVersion(undefined);
      return;
    }
    setLoading(true);
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
      }
    } finally {
      setLoading(false);
    }
  }, [previewFile, projectId, sessionId]);

  useEffect(() => {
    void loadFile();
    setMode("read");
  }, [loadFile]);

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
    if (!previewFile || !isDirty) {
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
      });
      if (result.ok) {
        setSavedContent(content);
        await loadFile();
        refreshWorkspaceTrees();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <header className="column-header" id="preview-header" aria-label="文件预览">
        <span className="column-header__title">文件预览</span>
        {previewFile ? (
          <PreviewBreadcrumb
            filePath={previewFile.path}
            workspaceScope={previewFile.workspaceScope}
            onSelectPath={(path) =>
              selectPreviewFile(previewFile.workspaceScope, path)
            }
            onExpandDir={requestTreeExpandPath}
          />
        ) : (
          <span className="column-header__meta" id="preview-filename">
            —
          </span>
        )}
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
          {previewFile && mode === "edit" ? (
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
        ) : loading ? (
          <div className="preview-body" id="preview-body">
            <p className="preview-empty">加载中…</p>
          </div>
        ) : mode === "read" ? (
          <div className="preview-body" id="preview-body">
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
    </>
  );
}
