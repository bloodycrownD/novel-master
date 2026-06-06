import type { NovelMasterDesktopBridge } from "../src/preload/preload";

declare global {
  interface Window {
    novelMasterDesktop: NovelMasterDesktopBridge;
  }
}

export {};
