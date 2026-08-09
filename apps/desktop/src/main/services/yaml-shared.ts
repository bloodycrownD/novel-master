/**
 * Desktop YAML 导入导出的公共编排。
 *
 * 这里集中处理 Electron dialog 的保存/打开对话框、临时文件落盘，
 * 以及统一的错误归一。具体每个 schema 的 decode/encode 和落库逻辑
 * 交给调用方以回调注入，避免把业务知识塞进这层。
 */
import { dialog, type BrowserWindow } from "electron";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 把任意错误归一成 `Error`，并在前面拼上业务 fallback 文案。 */
export function normalizeYamlError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return new Error(`${fallback}：${error.message}`);
  }
  return new Error(fallback);
}

/**
 * 通过系统保存对话框把 YAML 文本落盘。
 *
 * 内部先写入 os.tmpdir() 下的临时文件（用作 defaultPath 参考），
 * 弹出保存对话框后再写到用户选定的路径；不管成功还是取消，
 * 都会在 finally 里清理临时文件。
 */
export async function exportYamlWithDialog(
  yaml: string,
  fileName: string,
  parentWindow?: BrowserWindow | null,
): Promise<"saved" | "cancelled"> {
  const tmpPath = join(tmpdir(), fileName);
  await writeFile(tmpPath, yaml, "utf8");

  const win = parentWindow ?? undefined;
  try {
    const result = win
      ? await dialog.showSaveDialog(win, {
          defaultPath: fileName,
          filters: [{ name: "YAML", extensions: ["yaml", "yml"] }],
        })
      : await dialog.showSaveDialog({
          defaultPath: fileName,
          filters: [{ name: "YAML", extensions: ["yaml", "yml"] }],
        });
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
 * 打开对话框 + readFile 之后，decode/validate/persist 的逻辑
 * 全部由调用方在 `consume` 里完成，方便按各 schema 自己处理。
 */
export async function importYamlWithDialog(
  consume: (yamlText: string) => Promise<void>,
  parentWindow?: BrowserWindow | null,
): Promise<"imported" | "cancelled"> {
  const win = parentWindow ?? undefined;
  const result = win
    ? await dialog.showOpenDialog(win, {
        filters: [{ name: "YAML", extensions: ["yaml", "yml"] }],
        properties: ["openFile"],
      })
    : await dialog.showOpenDialog({
        filters: [{ name: "YAML", extensions: ["yaml", "yml"] }],
        properties: ["openFile"],
      });
  if (result.canceled || result.filePaths.length === 0) {
    return "cancelled";
  }

  const yaml = await readFile(result.filePaths[0]!, "utf8");
  await consume(yaml);
  return "imported";
}
