import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("novelMasterDesktop", {
  version: "0.0.0",
});
