/**
 * Smoke: preload exposes novelMasterDesktop when loading packaged renderer HTML.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, "..");

app.whenReady().then(async () => {
  const preloadPath = path.join(
    desktopRoot,
    "dist/src/preload/preload.cjs",
  );
  const indexPath = path.join(desktopRoot, "dist/renderer/index.html");

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.on("preload-error", (_event, preloadPathArg, error) => {
    console.error("PRELOAD_ERROR", preloadPathArg, error);
    app.exit(1);
  });

  await window.loadFile(indexPath);
  const hasBridge = await window.webContents.executeJavaScript(
    "Boolean(window.novelMasterDesktop && window.novelMasterDesktop.invoke)",
  );
  console.log(hasBridge ? "PRELOAD_BRIDGE_OK" : "PRELOAD_BRIDGE_MISSING");
  app.exit(hasBridge ? 0 : 1);
});
