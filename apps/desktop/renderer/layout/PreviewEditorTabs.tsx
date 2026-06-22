import { useShellNav } from "../providers/ShellNavProvider";
import { previewTabKey } from "./preview-tab-utils";

export function PreviewEditorTabs() {
  const {
    previewTabs,
    activePreviewKey,
    selectPreviewFile,
    closePreviewTab,
  } = useShellNav();

  if (previewTabs.length === 0) {
    return <div className="preview-editor-tabs preview-editor-tabs--empty" />;
  }

  return (
    <div
      className="preview-editor-tabs"
      role="tablist"
      aria-label="打开的文件"
    >
      {previewTabs.map((tab) => {
        const key = previewTabKey(tab.workspaceScope, tab.path);
        const isActive = key === activePreviewKey;
        return (
          <div
            key={key}
            className={`preview-editor-tabs__tab${isActive ? " is-active" : ""}`}
            role="presentation"
          >
            <button
              type="button"
              className="preview-editor-tabs__label"
              role="tab"
              aria-selected={isActive}
              title={tab.path}
              onClick={() => selectPreviewFile(tab.workspaceScope, tab.path)}
            >
              {tab.name}
            </button>
            <button
              type="button"
              className="preview-editor-tabs__close"
              aria-label="关闭"
              onClick={(event) => {
                event.stopPropagation();
                closePreviewTab(tab.workspaceScope, tab.path);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
