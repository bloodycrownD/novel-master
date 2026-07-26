/**
 * Desktop VFS 角色卡导入：Electron dialog 选 png/json → Core importFromBytes。
 *
 * 编排与 ZIP 导入同构：确认在 Renderer，选文件在 Main，解析在选文件之后、写库之前。
 *
 * @module services/vfs-character-card
 */
import {
  createCharacterCardImportService,
  type VfsScope,
} from "@novel-master/core/vfs";
import { dialog, type BrowserWindow } from "electron";
import { readFile } from "node:fs/promises";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

function resolveDirectoryPath(directoryPath?: string): string {
  if (directoryPath == null || directoryPath.trim() === "") {
    return "/";
  }
  return directoryPath;
}

/**
 * 弹出文件选择框，读取 png/json 字节后调用 Core 角色卡导入。
 * 取消选文件返回 `cancelled`；解析/写库失败抛 {@link CharacterCardError}。
 */
export async function importCharacterCardWithDialog(
  runtime: DesktopNovelMasterRuntime,
  scope: VfsScope,
  options: { readonly confirmed: boolean; readonly directoryPath?: string },
  parentWindow?: BrowserWindow | null,
): Promise<"imported" | "cancelled"> {
  const directoryPath = resolveDirectoryPath(options.directoryPath);
  const win = parentWindow ?? undefined;
  const dialogOpts = {
    filters: [
      { name: "角色卡", extensions: ["png", "json"] },
      { name: "PNG", extensions: ["png"] },
      { name: "JSON", extensions: ["json"] },
    ],
    properties: ["openFile" as const],
  };
  const result = win
    ? await dialog.showOpenDialog(win, dialogOpts)
    : await dialog.showOpenDialog(dialogOpts);
  if (result.canceled || result.filePaths.length === 0) {
    return "cancelled";
  }

  const bytes = new Uint8Array(await readFile(result.filePaths[0]!));
  const cardSvc = createCharacterCardImportService(runtime.conn);
  await cardSvc.importFromBytes(scope, bytes, {
    confirmed: options.confirmed,
    directoryPath,
  });
  return "imported";
}
