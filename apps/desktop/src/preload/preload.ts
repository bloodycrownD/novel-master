/**
 * Preload bridge — exposes a minimal typed IPC surface to the sandboxed renderer.
 * Renderer must not import @novel-master/core; all domain access goes through invoke.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { IpcChannel } from "../../shared/ipc-types.js";

export interface NovelMasterDesktopBridge {
  readonly version: string;
  invoke<T = unknown>(channel: IpcChannel, payload?: unknown): Promise<T>;
  on(channel: IpcChannel, callback: (payload: unknown) => void): () => void;
  off(channel: IpcChannel, callback: (payload: unknown) => void): void;
}

const novelMasterDesktop: NovelMasterDesktopBridge = {
  version: "0.0.0",
  invoke(channel, payload) {
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel, callback) {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      callback(payload);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
  off(channel, callback) {
    ipcRenderer.removeListener(channel, callback as never);
  },
};

contextBridge.exposeInMainWorld("novelMasterDesktop", novelMasterDesktop);
