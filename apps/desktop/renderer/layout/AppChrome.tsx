import { useTheme } from "../providers/ThemeProvider";
import type { UseColumnSplittersResult } from "../hooks/useColumnSplitters";

interface AppChromeProps {
  columnLayout: Pick<
    UseColumnSplittersResult,
    "columnVisibility" | "toggleColumn"
  >;
  settingsOpen: boolean;
  onToggleSettings: () => void;
}

export function AppChrome({
  columnLayout,
  settingsOpen,
  onToggleSettings,
}: AppChromeProps) {
  const { mode, toggleMode } = useTheme();
  const { columnVisibility, toggleColumn } = columnLayout;

  return (
    <header id="app-chrome" aria-label="全局操作">
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
              <button
                key={key}
                type="button"
                className={`icon-btn column-toggle${columnVisibility[key] ? " is-active" : ""}`}
                id={`toggle-column-${key}`}
                data-column={key}
                aria-label={`显示或隐藏${labels[key]}`}
                title={labels[key]}
                onClick={() => toggleColumn(key)}
              >
                {icons[key]}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="icon-btn theme-toggle"
          id="theme-toggle"
          aria-label="切换主题"
          onClick={() => void toggleMode()}
        >
          {mode === "dark" ? "☾" : "☀"}
        </button>
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
    </header>
  );
}
