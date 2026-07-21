/**
 * Preload bridge — exposes a minimal typed IPC surface to the sandboxed renderer.
 * Renderer must not import @novel-master/core; all domain access goes through invoke.
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  IPC_CHANNELS,
  type IpcChannel,
  type VfsStartDragRequest,
} from "../../shared/ipc-types.js";
import pkg from "../../package.json" with { type: "json" };

export interface NovelMasterDesktopBridge {
  readonly version: string;
  readonly platform: NodeJS.Platform;
  /** Windows overlay / macOS hiddenInset — in-window drag region. */
  readonly customTitleBar: boolean;
  readonly inWindowMenuBar: boolean;
  invoke<T = unknown>(channel: IpcChannel, payload?: unknown): Promise<T>;
  on(channel: IpcChannel, callback: (payload: unknown) => void): () => void;
  off(channel: IpcChannel, callback: (payload: unknown) => void): void;
  /** 将 File 对象解析为本机绝对路径（拖入导入）。 */
  getPathForFile(file: File): string;
  /**
   * 触发 main `webContents.startDrag`（拖出导出）。
   * 须在 dragstart 中 `preventDefault` 后调用；filePaths 来自 batchExportStage。
   */
  startDrag(filePaths: readonly string[]): void;
}

// on() registers an internal ipcRenderer listener wrapper; off() must resolve the same
// wrapper from the user callback or removeListener never matches the subscription.
const ipcListenerByCallback = new WeakMap<
  (payload: unknown) => void,
  (_event: Electron.IpcRendererEvent, payload: unknown) => void
>();

const novelMasterDesktop: NovelMasterDesktopBridge = {
  version: pkg.version,
  platform: process.platform,
  customTitleBar:
    process.platform === "win32" || process.platform === "darwin",
  inWindowMenuBar: false,
  invoke(channel, payload) {
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel, callback) {
    let listener = ipcListenerByCallback.get(callback);
    if (!listener) {
      listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        callback(payload);
      };
      ipcListenerByCallback.set(callback, listener);
    }
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
      ipcListenerByCallback.delete(callback);
    };
  },
  off(channel, callback) {
    const listener = ipcListenerByCallback.get(callback);
    if (listener) {
      ipcRenderer.removeListener(channel, listener);
      ipcListenerByCallback.delete(callback);
    }
  },
  getPathForFile(file) {
    return webUtils.getPathForFile(file);
  },
  startDrag(filePaths) {
    const payload: VfsStartDragRequest = { filePaths: [...filePaths] };
    ipcRenderer.send(IPC_CHANNELS.VFS_START_DRAG, payload);
  },
};

contextBridge.exposeInMainWorld("novelMasterDesktop", novelMasterDesktop);
