/**
 * Electron main process: window lifecycle and Vite renderer load (D0 scaffold).
 */
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_SERVER_URL = "http://localhost:5173";
const isDev = !app.isPackaged;

function resolvePreloadPath(): string {
  return path.join(__dirname, "../preload/preload.js");
}

function resolveRendererIndex(): string {
  return path.join(app.getAppPath(), "dist/renderer/index.html");
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: "Novel Master",
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  if (isDev) {
    void window.loadURL(DEV_SERVER_URL);
  } else {
    void window.loadFile(resolveRendererIndex());
  }

  return window;
}

app.whenReady().then(() => {
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
