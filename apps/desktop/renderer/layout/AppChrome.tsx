import { useEffect } from "react";
import { coreT } from "@shared/logic/core-i18n";
import { useTheme } from "../providers/ThemeProvider";
import type { UseColumnSplittersResult } from "../hooks/useColumnSplitters";
import { Tooltip } from "../components/ui/Tooltip";
import { getDesktopBridge } from "../ipc/client";
import appIcon from "@assets/icon.webp";

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

    useEffect(() => {
        try {
            document.documentElement.dataset.platform = getDesktopBridge().platform;
        } catch {
            delete document.documentElement.dataset.platform;
        }
        return () => {
            delete document.documentElement.dataset.platform;
        };
    }, []);

    return (
        <header
            id="app-chrome"
            className={customTitleBar ? "app-chrome--custom-titlebar" : undefined}
            aria-label={coreT({key: "ui.nav.global_actions"})}
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
                        aria-label={coreT({key: "ui.nav.pane_visibility"})}
                    >
                        {(["preview", "explorer", "chat"] as const).map((key) => {
                            const labels = {
                                preview: coreT({key: "ui.nav.pane_left"}),
                                explorer: coreT({key: "ui.nav.pane_center"}),
                                chat: coreT({key: "ui.nav.pane_right"}),
                            };
                            const icons = { preview: "◧", explorer: "▥", chat: "◨" };
                            return (
                                <Tooltip key={key} content={labels[key]}>
                                    <button
                                        type="button"
                                        className={`icon-btn column-toggle${columnVisibility[key] ? " is-active" : ""}`}
                                        id={`toggle-column-${key}`}
                                        data-column={key}
                                        aria-label={coreT({key: "ui.nav.pane_toggle_aria", params: {label: labels[key]}})}
                                        onClick={() => toggleColumn(key)}
                                    >
                                        {icons[key]}
                                    </button>
                                </Tooltip>
                            );
                        })}
                    </div>
                    <Tooltip content={mode === "dark" ? coreT({key: "ui.nav.toggle_light_theme"}) : coreT({key: "ui.nav.toggle_dark_theme"})}>
                        <button
                            type="button"
                            className="icon-btn theme-toggle"
                            id="theme-toggle"
                            aria-label={coreT({key: "ui.nav.toggle_theme"})}
                            onClick={() => void toggleMode()}
                        >
                            {mode === "dark" ? "☾" : "☀"}
                        </button>
                    </Tooltip>
                    <button
                        type="button"
                        className={`icon-btn${settingsOpen ? " is-active" : ""}`}
                        id="settings-open"
                        aria-label={settingsOpen ? coreT({key: "ui.nav.close_settings"}) : coreT({key: "ui.nav.open_settings"})}
                        onClick={onToggleSettings}
                    >
                        ⚙
                    </button>
                </div>
            </div>
        </header>
    );
}
