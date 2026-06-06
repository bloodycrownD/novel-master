export function PreviewPane() {
  return (
    <>
      <header className="column-header" id="preview-header" aria-label="文件预览">
        <span className="column-header__title">文件预览</span>
        <span className="column-header__meta" id="preview-filename">
          —
        </span>
        <div className="column-header__actions">
          <div className="preview-mode-toggle" role="group" aria-label="预览模式">
            <button
              type="button"
              className="preview-mode-btn is-active"
              id="preview-mode-read"
              data-action="set-preview-mode"
              data-preview-mode="read"
            >
              预览
            </button>
            <button
              type="button"
              className="preview-mode-btn"
              id="preview-mode-edit"
              data-action="set-preview-mode"
              data-preview-mode="edit"
            >
              编辑
            </button>
          </div>
        </div>
      </header>
      <section id="preview-pane" aria-label="文件预览">
        <div className="preview-body" id="preview-body">
          <p className="preview-empty">在工作区选择文件以预览</p>
        </div>
        <textarea
          className="preview-editor hidden"
          id="preview-editor"
          spellCheck={false}
          aria-label="文件编辑"
          readOnly
        />
      </section>
    </>
  );
}
