/**
 * Electron main process: window lifecycle, Vite renderer load, IPC, runtime teardown.
 */
import { app, BrowserWindow, nativeImage } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDesktopConnection } from "./runtime/connection.js";
import {
  attachEventBusForwarder,
  setEventBusForwardTarget,
} from "./ipc/forward-event-bus.js";
import { registerIpcHandlers } from "./ipc/register-handlers.js";
import { getDesktopRuntime } from "./runtime/desktop-runtime-singleton.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_SERVER_URL = "http://localhost:5173";
const isDev = !app.isPackaged;

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
    title: "Novel Master",
    width: 1280,
    height: 800,
    show: false,
    ...(iconPath ? { icon: nativeImage.createFromPath(iconPath) } : {}),
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.on("preload-error", (_event, preloadPath, err) => {
    console.error("[desktop] preload failed:", preloadPath, err);
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  setEventBusForwardTarget(() => {
    const focused = BrowserWindow.getFocusedWindow();
    return (focused ?? window).webContents;
  });

  if (isDev) {
    void window.loadURL(DEV_SERVER_URL);
  } else {
    void window.loadFile(resolveRendererIndex());
  }

  return window;
}

async function bootstrapMainServices(): Promise<void> {
  registerIpcHandlers();
  const runtime = await getDesktopRuntime();
  attachEventBusForwarder(runtime.eventBus);
}

app.whenReady().then(async () => {
  await bootstrapMainServices();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void closeDesktopConnection();
});
