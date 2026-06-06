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

// on() registers an internal ipcRenderer listener wrapper; off() must resolve the same
// wrapper from the user callback or removeListener never matches the subscription.
const ipcListenerByCallback = new WeakMap<
  (payload: unknown) => void,
  (_event: Electron.IpcRendererEvent, payload: unknown) => void
>();

const novelMasterDesktop: NovelMasterDesktopBridge = {
  version: "0.0.0",
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
};

contextBridge.exposeInMainWorld("novelMasterDesktop", novelMasterDesktop);
