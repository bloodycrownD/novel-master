import { useState } from "react";
import { useColumnSplitters } from "./hooks/useColumnSplitters";
import { AppChrome } from "./layout/AppChrome";
import { MainShell } from "./layout/MainShell";
import { SettingsOverlay } from "./layout/SettingsOverlay";
import { NovelMasterProvider } from "./providers/NovelMasterProvider";
import { ShellNavProvider } from "./providers/ShellNavProvider";
import { ThemeProvider } from "./providers/ThemeProvider";

function DesktopShell() {
  const columnLayout = useColumnSplitters();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <ThemeProvider>
      <ShellNavProvider>
        <div id="app">
          <AppChrome
            columnLayout={columnLayout}
            settingsOpen={settingsOpen}
            onToggleSettings={() => setSettingsOpen((open) => !open)}
          />
          <div id="main-shell" hidden={settingsOpen} className={settingsOpen ? "hidden" : undefined}>
            <MainShell workspaceRef={columnLayout.workspaceRef} />
          </div>
          <SettingsOverlay
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
          />
        </div>
      </ShellNavProvider>
    </ThemeProvider>
  );
}

function AppContent() {
  return <DesktopShell />;
}

export function App() {
  return (
    <NovelMasterProvider>
      <AppContent />
    </NovelMasterProvider>
  );
}
