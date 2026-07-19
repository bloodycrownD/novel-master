/**
 * Electron main process: window lifecycle, Vite renderer load, IPC, runtime teardown.
 */
import { app, BrowserWindow, nativeImage } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDesktopConnection } from "./runtime/connection.js";
import {
  attachAgentRunLifecycleListeners,
} from "./ipc/handlers/agent.js";
import {
  attachEventBusForwarder,
  setEventBusForwardTarget,
} from "./ipc/forward-event-bus.js";
import {
  attachAgentActivityForwarder,
  setAgentActivityForwardTarget,
} from "./ipc/forward-agent-activity.js";
import { setWorkspaceMutatedForwardTarget } from "./ipc/forward-workspace-mutated.js";
import { setComposerAttachmentsSuggestForwardTarget } from "./ipc/forward-composer-attachments-suggest.js";
import { setUserMessageAppendedForwardTarget } from "./ipc/forward-user-message-appended.js";
import { registerIpcHandlers } from "./ipc/register-handlers.js";
import { getDesktopRuntime } from "./runtime/desktop-runtime-singleton.js";
import {
  configureWindowChrome,
  installApplicationMenu,
  titleBarOverlayOptions,
} from "./shell-menu.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_SERVER_URL = "http://localhost:5173";
const isDev = !app.isPackaged;

let detachEventBusForwarder: (() => void) | undefined;
let detachAgentActivityForwarder: (() => void) | undefined;
let detachAgentRunLifecycleListeners: (() => void) | undefined;

function resolvePreloadPath(): string {
  // Sandboxed preload must be CommonJS; ESM preload.js fails to execute in Electron.
  return path.join(__dirname, "../preload/preload.cjs");
}

function resolveRendererIndex(): string {
  return path.join(app.getAppPath(), "dist/renderer/index.html");
}

/** Dev: apps/desktop/build/icons; prod: extraResources sibling of dist. */
function resolveIconPath(): string | undefined {
  const candidates = [
    path.join(app.getAppPath(), "build/icons/icon.png"),
    path.join(app.getAppPath(), "..", "build/icons/icon.png"),
    path.join(__dirname, "../../build/icons/icon.png"),
    path.join(__dirname, "../../../build/icons/icon.png"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function createMainWindow(): BrowserWindow {
  const iconPath = resolveIconPath();
  const window = new BrowserWindow({
    title: "",
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 12, y: 12 },
        }
      : process.platform === "win32"
        ? {
            titleBarStyle: "hidden" as const,
            titleBarOverlay: titleBarOverlayOptions("light"),
          }
        : {}),
    ...(iconPath ? { icon: nativeImage.createFromPath(iconPath) } : {}),
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  configureWindowChrome(window);

  window.webContents.on("preload-error", (_event, preloadPath, err) => {
    console.error("[desktop] preload failed:", preloadPath, err);
  });

  window.webContents.on("did-fail-load", (_event, code, desc, url) => {
    console.error("[desktop] renderer load failed:", code, desc, url);
    if (!window.isDestroyed() && !window.isVisible()) {
      window.show();
    }
  });

  const showFallback = setTimeout(() => {
    if (!window.isDestroyed() && !window.isVisible()) {
      console.warn("[desktop] ready-to-show timeout — showing window anyway");
      window.show();
    }
  }, 8000);

  window.once("ready-to-show", () => {
    clearTimeout(showFallback);
    if (!window.isDestroyed()) {
      window.show();
    }
  });

  window.once("show", () => {
    clearTimeout(showFallback);
  });

  setEventBusForwardTarget(() => {
    const focused = BrowserWindow.getFocusedWindow();
    return (focused ?? window).webContents;
  });
  const resolvePushWebContents = () => {
    const focused = BrowserWindow.getFocusedWindow();
    return (focused ?? window).webContents;
  };
  setWorkspaceMutatedForwardTarget(resolvePushWebContents);
  setComposerAttachmentsSuggestForwardTarget(resolvePushWebContents);
  setUserMessageAppendedForwardTarget(resolvePushWebContents);
  setAgentActivityForwardTarget(resolvePushWebContents);

  if (isDev) {
    void window.loadURL(DEV_SERVER_URL);
  } else {
    void window.loadFile(resolveRendererIndex());
  }

  return window;
}

function detachMainEventBusListeners(): void {
  detachEventBusForwarder?.();
  detachEventBusForwarder = undefined;
  detachAgentRunLifecycleListeners?.();
  detachAgentRunLifecycleListeners = undefined;
  detachAgentActivityForwarder?.();
  detachAgentActivityForwarder = undefined;
}

async function bootstrapMainServices(): Promise<void> {
  registerIpcHandlers();
  const runtime = await getDesktopRuntime();
  detachMainEventBusListeners();
  detachEventBusForwarder = attachEventBusForwarder(runtime.eventBus);
  detachAgentRunLifecycleListeners = attachAgentRunLifecycleListeners(
    runtime.eventBus,
  );
  detachAgentActivityForwarder = attachAgentActivityForwarder();
}

app.whenReady().then(async () => {
  installApplicationMenu();
  createMainWindow();
  try {
    await bootstrapMainServices();
  } catch (error) {
    console.error("[desktop] bootstrap failed:", error);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}).catch((error) => {
  console.error("[desktop] startup failed:", error);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  detachMainEventBusListeners();
  void closeDesktopConnection();
});
