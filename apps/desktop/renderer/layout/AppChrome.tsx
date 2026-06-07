import { useEffect } from "react";
import { useTheme } from "../providers/ThemeProvider";
import type { UseColumnSplittersResult } from "../hooks/useColumnSplitters";
import { Tooltip } from "../components/ui/Tooltip";
import { getDesktopBridge } from "../ipc/client";
import appIcon from "../../../../icon.webp";

interface AppChromeProps {
  columnLayout: Pick<
    UseColumnSplittersResult,
    "columnVisibility" | "toggleColumn"
  >;
  settingsOpen: boolean;
  onToggleSettings: () => void;
}

function readShellFlags(): { customTitleBar: boolean } {
  try {
    const bridge = getDesktopBridge();
    return {
      customTitleBar: bridge.customTitleBar,
    };
  } catch {
    return { customTitleBar: false };
  }
}

export function AppChrome({
  columnLayout,
  settingsOpen,
  onToggleSettings,
}: AppChromeProps) {
  const { mode, toggleMode } = useTheme();
  const { columnVisibility, toggleColumn } = columnLayout;
  const { customTitleBar } = readShellFlags();

  useEffect(() => {
    if (customTitleBar) {
      document.documentElement.dataset.customTitlebar = "true";
    }
    return () => {
      delete document.documentElement.dataset.customTitlebar;
    };
  }, [customTitleBar]);

  return (
    <header
      id="app-chrome"
      className={customTitleBar ? "app-chrome--custom-titlebar" : undefined}
      aria-label="全局操作"
    >
      <div className="app-chrome__leading">
        <img
          src={appIcon}
          alt=""
          className="app-chrome__app-icon"
          width={20}
          height={20}
          draggable={false}
        />
      </div>
      <div className="app-chrome__trailing">
        <div className="app-chrome__actions">
          <div
            className="app-chrome__column-toggles"
            role="group"
            aria-label="栏位显示"
          >
            {(["preview", "explorer", "chat"] as const).map((key) => {
              const labels = {
                preview: "左侧栏（文件预览）",
                explorer: "中间栏（工作区）",
                chat: "右侧栏（聊天）",
              };
              const icons = { preview: "◧", explorer: "▥", chat: "◨" };
              return (
                <Tooltip key={key} content={labels[key]}>
                  <button
                    type="button"
                    className={`icon-btn column-toggle${columnVisibility[key] ? " is-active" : ""}`}
                    id={`toggle-column-${key}`}
                    data-column={key}
                    aria-label={`显示或隐藏${labels[key]}`}
                    onClick={() => toggleColumn(key)}
                  >
                    {icons[key]}
                  </button>
                </Tooltip>
              );
            })}
          </div>
          <Tooltip content={mode === "dark" ? "切换浅色主题" : "切换深色主题"}>
            <button
              type="button"
              className="icon-btn theme-toggle"
              id="theme-toggle"
              aria-label="切换主题"
              onClick={() => void toggleMode()}
            >
              {mode === "dark" ? "☾" : "☀"}
            </button>
          </Tooltip>
          <button
            type="button"
            className={`icon-btn${settingsOpen ? " is-active" : ""}`}
            id="settings-open"
            aria-label={settingsOpen ? "关闭设置" : "打开设置"}
            onClick={onToggleSettings}
          >
            ⚙
          </button>
        </div>
      </div>
    </header>
  );
}
