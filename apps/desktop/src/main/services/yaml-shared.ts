/**
 * Desktop YAML 导入导出的公共编排。
 *
 * 这里集中处理 Electron dialog 的保存/打开对话框、临时文件落盘。
 * 具体每个 schema 的 decode/encode 和落库逻辑交给调用方以回调注入，避免
 * 把业务知识塞进这层。
 */
import { dialog, type BrowserWindow } from "electron";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result } from "@novel-master/core/errors";

/**
 * 通过系统保存对话框把 YAML 文本落盘。
 *
 * 内部先写入 os.tmpdir() 下的临时文件（用作 defaultPath 参考），
 * 弹出保存对话框后再写到用户选定的路径；不管成功还是取消，
 * 都会在 finally 里清理临时文件。
 */
export async function exportYamlWithDialog(yaml: string, fileName: string, parentWindow?: BrowserWindow | null): Promise<"saved" | "cancelled"> {
  const tmpPath = join(tmpdir(), fileName);
  await writeFile(tmpPath, yaml, "utf8");

  const win = parentWindow ?? undefined;
  try {
    const saveDialogOptions: Electron.SaveDialogOptions = { defaultPath: fileName, filters: [{ name: "YAML", extensions: ["yaml", "yml"] }] };
    const result = win ? await dialog.showSaveDialog(win, saveDialogOptions) : await dialog.showSaveDialog(saveDialogOptions);
    if (result.canceled || result.filePath == null) {
      return "cancelled";
    }
    await writeFile(result.filePath, yaml, "utf8");
    return "saved";
  } finally {
    await unlink(tmpPath).catch(() => undefined);
  }
}

/**
 * 通过系统打开对话框挑选一个 YAML 文件，把内容交给 `consume` 回调。
 *
 * 打开对话框 + readFile 之后，decode/validate/persist 的逻辑全部由调用方在
 * `consume` 里完成。通道与 mobile 对齐（`Result`）：consume 的已知失败沿
 * `Result.err` 接力；readFile 等平台异常仍走 reject，由调用方 catch 收口。
 */
export async function importYamlWithDialog(consume: (yamlText: string) => Promise<Result<void, Error>>, parentWindow?: BrowserWindow | null): Promise<Result<"imported" | "cancelled", Error>> {
  const win = parentWindow ?? undefined;
  const openDialogOptions: Electron.OpenDialogOptions = { filters: [{ name: "YAML", extensions: ["yaml", "yml"] }], properties: ["openFile"] };
  const result = win ? await dialog.showOpenDialog(win, openDialogOptions) : await dialog.showOpenDialog(openDialogOptions);
  if (result.canceled || result.filePaths.length === 0) {
    return Result.ok("cancelled");
  }

  const yaml = await readFile(result.filePaths[0]!, "utf8");
  const consumed = await consume(yaml);
  if (!consumed.ok) return Result.err(consumed.error);
  return Result.ok("imported");
}
