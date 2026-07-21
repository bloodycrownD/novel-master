/** Minimal Electron stub for main-process tests under system Node. */
export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
};

export class BrowserWindow {
  static getFocusedWindow() {
    return null;
  }
}

export const app = {
  isPackaged: false,
  getAppPath() {
    return "/tmp/novel-master-test-app";
  },
  getPath(name) {
    return name === "userData" ? "/tmp/novel-master-test-user-data" : "/tmp";
  },
};

export const nativeImage = {
  createEmpty() {
    return { isEmpty: () => true };
  },
  createFromPath(_path) {
    return {
      isEmpty: () => false,
      resize() {
        return { isEmpty: () => false };
      },
    };
  },
  createFromBuffer(_buf) {
    return { isEmpty: () => false };
  },
};
