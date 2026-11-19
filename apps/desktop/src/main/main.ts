/**
 * Electron main process: window lifecycle, Vite renderer load, IPC, runtime teardown.
 */
import { app, BrowserWindow, nativeImage, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chatLinkResolver } from "@novel-master/core/chat";
import { LogFactory } from "@novel-master/core/log";
import { installDesktopLogSink } from "./log/desktop-log-sink.js";
import { closeDesktopConnection } from "./runtime/connection.js";
import { resolveAppIconPath } from "./runtime/resolve-app-icon.js";
import { attachAgentRunLifecycleListeners } from "./ipc/handlers/agent.js";
import { EventBusForwarder } from "./ipc/forward-event-bus.js";
import { AgentActivityForwarder } from "./ipc/forward-agent-activity.js";
import { WorkspaceMutatedForwarder } from "./ipc/forward-workspace-mutated.js";
import { ComposerAttachmentsSuggestForwarder } from "./ipc/forward-composer-attachments-suggest.js";
import { PromptChatTokenUpdatedForwarder } from "./ipc/forward-prompt-chat-token-updated.js";
import { UserMessageAppendedForwarder } from "./ipc/forward-user-message-appended.js";
import { registerIpcHandlers } from "./ipc/register-handlers.js";
import { getDesktopRuntime } from "./runtime/desktop-runtime-singleton.js";
import { installApplicationMenu, titleBarOverlayOptions } from "./shell-menu.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_SERVER_URL = "http://localhost:5173";
const isDev = !app.isPackaged;
const log = LogFactory.create("desktop.main");

// 文件 sink 必须在 app.whenReady() 之前装好：启动早期的失败也要留痕。
installDesktopLogSink();

let detachEventBusForwarder: (() => void) | undefined;
let detachAgentActivityForwarder: (() => void) | undefined;
let detachAgentRunLifecycleListeners: (() => void) | undefined;

function createMainWindow(): BrowserWindow {
  const iconPath = resolveAppIconPath();
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
      // Sandboxed preload must be CommonJS; ESM preload.js fails to execute in Electron.
      preload: path.join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 原 configureWindowChrome 内联：置空标题 + Windows/Linux 隐藏菜单栏。
  window.setTitle("");
  if (process.platform === "win32" || process.platform === "linux") {
    window.setMenuBarVisibility(false);
  }

  window.webContents.on("preload-error", (_event, preloadPath, err) => {
    log.error("preload failed", { preloadPath, error: err });
  });

  window.webContents.on("did-fail-load", (_event, code, desc, url) => {
    log.error("renderer load failed", { code, description: desc, url });
    if (!window.isDestroyed() && !window.isVisible()) {
      window.show();
    }
  });

  const showFallback = setTimeout(() => {
    if (!window.isDestroyed() && !window.isVisible()) {
      log.warn("ready-to-show timeout — showing window anyway");
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

  EventBusForwarder.setTarget(() => {
    const focused = BrowserWindow.getFocusedWindow();
    return (focused ?? window).webContents;
  });
  const resolvePushWebContents = () => {
    const focused = BrowserWindow.getFocusedWindow();
    return (focused ?? window).webContents;
  };
  WorkspaceMutatedForwarder.setTarget(resolvePushWebContents);
  ComposerAttachmentsSuggestForwarder.setTarget(resolvePushWebContents);
  PromptChatTokenUpdatedForwarder.setTarget(resolvePushWebContents);
  UserMessageAppendedForwarder.setTarget(resolvePushWebContents);
  AgentActivityForwarder.setTarget(resolvePushWebContents);

  // 链接导航拦截（chat-link-file-nav）：renderer 内链接点击已在组件层拦截
  // 路由（MermaidMarkdown onLinkClick），但 PreviewPane 等未接链路的 <a>
  // 默认导航仍会整窗跳走——主进程统一兜底：页内导航一律拒绝，
  // http(s) 转交系统浏览器，其余（file:// 等）直接否决；新开窗口同理 deny。
  // 例外：dev 模式放行 vite dev server 同源导航——location.reload() 同样
  // 触发 will-navigate，无条件拦截会把 vite full-reload（依赖变更、HMR 失败
  // 回退）拦死，页面停留在旧构建；生产无 vite reload，reload 本就该拦。
  window.webContents.on("will-navigate", (event, url) => {
    if (isDev && url.startsWith(DEV_SERVER_URL)) {
      return; // dev：vite full-reload 放行
    }
    event.preventDefault();
    if (chatLinkResolver.isHttp(url)) {
      void shell.openExternal(url).catch(() => undefined);
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (chatLinkResolver.isHttp(url)) {
      void shell.openExternal(url).catch(() => undefined);
    }
    return { action: "deny" };
  });

  if (isDev) {
    void window.loadURL(DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(app.getAppPath(), "dist/renderer/index.html"));
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

app.whenReady().then(async () => {
  installApplicationMenu();
  createMainWindow();
  try {
    registerIpcHandlers();
    const built = await getDesktopRuntime();
    // 装配的已知失败在进程级边界收口（错误通道迁移七期）：落日志后继续，
    // 窗口仍在（与旧 catch 的未知异常分支同一终点）；未知异常仍走下方 catch。
    if (!built.ok) {
      log.error("bootstrap failed", { error: built.error });
    } else {
      const runtime = built.value;
      detachMainEventBusListeners();
      detachEventBusForwarder = EventBusForwarder.attach(runtime.eventBus);
      detachAgentRunLifecycleListeners = attachAgentRunLifecycleListeners(runtime.eventBus);
      detachAgentActivityForwarder = AgentActivityForwarder.attach();
    }
  } catch (error) {
    log.error("bootstrap failed", { error });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}).catch((error) => {
  log.error("startup failed", { error });
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
