/**
 * 解析应用窗口 / 拖出图标路径。
 * Dev: apps/desktop/build/icons；prod: extraResources sibling of dist。
 */
import { app } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveAppIconPath(): string | undefined {
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
