interface SettingsOverlayProps {
  open: boolean;
  onClose: () => void;
}

/** D6 will replace placeholder content with full SETTINGS_NAV views. */
export function SettingsOverlay({ open, onClose }: SettingsOverlayProps) {
  return (
    <div
      id="settings-page"
      className={`settings-page${open ? "" : " hidden"}`}
      hidden={!open}
      aria-hidden={!open}
    >
      <div className="settings-page__body">
        <nav className="settings-nav" id="settings-nav" aria-label="设置分类" />
        <div className="settings-main">
          <header className="settings-main__header" id="settings-main-header">
            <button
              type="button"
              className="settings-main__back hidden"
              id="settings-main-back"
              data-action="settings-back"
              aria-label="返回上一级"
            >
              ‹
            </button>
            <h2 className="settings-main__title" id="settings-main-title">
              设置
            </h2>
          </header>
          <div className="settings-page__content" id="settings-page-root">
            <p style={{ padding: "1rem", color: "var(--text-secondary)" }}>
              设置页内容将在 D6 实现。
            </p>
            <button type="button" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
