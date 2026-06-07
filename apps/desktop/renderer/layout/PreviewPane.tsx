import { useCallback, useEffect, useState } from "react";
import Markdown from "react-markdown";
import { ipcVfsRead, ipcVfsWrite, vfsScope } from "../ipc/client";
import { useShellNav } from "../providers/ShellNavProvider";

export function PreviewPane() {
  const { previewFile, projectId, sessionId, refreshWorkspaceTrees } =
    useShellNav();
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
  const isMarkdown = previewFile?.name.endsWith(".md") ?? false;

  const save = async () => {
    if (!previewFile || !isDirty) {
      return;
    }
    setSaving(true);
    try {
      await ipcVfsWrite({
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
      setSavedContent(content);
      await loadFile();
      refreshWorkspaceTrees();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <header className="column-header" id="preview-header" aria-label="文件预览">
        <span className="column-header__title">文件预览</span>
        <span className="column-header__meta" id="preview-filename">
          {previewFile?.name ?? "—"}
        </span>
        <div className="column-header__actions">
          <div className="preview-mode-toggle" role="group" aria-label="预览模式">
            <button
              type="button"
              className={`preview-mode-btn${mode === "read" ? " is-active" : ""}`}
              id="preview-mode-read"
              onClick={() => setMode("read")}
            >
              预览
            </button>
            <button
              type="button"
              className={`preview-mode-btn${mode === "edit" ? " is-active" : ""}`}
              id="preview-mode-edit"
              onClick={() => setMode("edit")}
            >
              编辑
            </button>
          </div>
          {previewFile && mode === "edit" ? (
            <button
              type="button"
              className="preview-mode-btn"
              disabled={!isDirty || saving}
              onClick={() => void save()}
            >
              {saving ? "保存中…" : "保存"}
            </button>
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
                <Markdown>{content}</Markdown>
              </div>
            ) : (
              <pre className="preview-text">{content || "（空文件）"}</pre>
            )}
          </div>
        ) : (
          <textarea
            className="preview-editor"
            id="preview-editor"
            spellCheck={false}
            aria-label="文件编辑"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        )}
      </section>
    </>
  );
}
