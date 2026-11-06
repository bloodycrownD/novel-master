/**
 * 桌面端诊断动作：打开日志目录 / 导出诊断包。
 *
 * 两个动作都做成「seams 全量注入」的函数——目录枚举、对话框、文件复制、打开
 * 目录、时间与版本信息全部由调用方传入，测试不用碰 electron 与真实磁盘。
 *
 * @module log/desktop-diagnostics
 */
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, dialog, shell } from "electron";

/** 导出诊断包需要的全部外部能力。 */
// nm-style: keep-public — spec 4.6 要求的 seams 契约：菜单动作与测试共用同一份形状。
export interface DiagnosticsSeams {
  readonly logsDir: string;
  readonly readdir: (dir: string) => Promise<readonly string[]>;
  readonly stat: (file: string) => Promise<{ readonly size: number }>;
  readonly showOpenDialog: (options: { readonly properties: readonly ("openDirectory" | "createDirectory")[] }) => Promise<{ readonly canceled: boolean; readonly filePaths: readonly string[] }>;
  readonly mkdir: (dir: string, options: { readonly recursive: boolean }) => Promise<unknown>;
  readonly copyFile: (source: string, target: string) => Promise<unknown>;
  readonly writeFile: (file: string, data: string, encoding: "utf8") => Promise<unknown>;
  readonly openPath: (target: string) => Promise<string>;
  readonly now: () => Date;
  readonly appVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly packaged: boolean;
}

/** 真实 Electron / node:fs 实现；菜单动作走这份。 */
export function createDesktopDiagnosticsSeams(): DiagnosticsSeams {
  return {
    logsDir: app.getPath("logs"),
    readdir: (dir) => readdir(dir),
    stat: (file) => stat(file),
    showOpenDialog: (options) => dialog.showOpenDialog({ properties: [...options.properties] }),
    mkdir: (dir, options) => mkdir(dir, options),
    copyFile: (source, target) => copyFile(source, target),
    writeFile: (file, data, encoding) => writeFile(file, data, encoding),
    openPath: (target) => shell.openPath(target),
    now: () => new Date(),
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 「打开日志目录」：把 logs 目录交给系统文件管理器。 */
// nm-style: keep-public — spec 4.6 点名的菜单动作，shell-menu 接线、测试直接调用。
export async function openLogsDirectory(seams: Pick<DiagnosticsSeams, "logsDir" | "openPath">): Promise<void> {
  await seams.openPath(seams.logsDir);
}

/**
 * 「导出诊断包」：选目标父目录 → 建 `nm-diagnostics-<时间>/` → 复制全部 `*.log`
 * → 写 `meta.json` → 打开新目录。取消时返回 undefined。
 */
// nm-style: keep-public — spec 4.6 点名的菜单动作，shell-menu 接线、测试直接调用。
export async function exportDiagnostics(seams: DiagnosticsSeams): Promise<string | undefined> {
  const picked = await seams.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  const parent = picked.filePaths[0];
  if (picked.canceled || parent === undefined) {
    return undefined;
  }
  const now = seams.now();
  const targetDir = path.join(parent, `nm-diagnostics-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`);
  await seams.mkdir(targetDir, { recursive: true });
  const names = (await seams.readdir(seams.logsDir)).filter((name) => name.endsWith(".log")).sort();
  const files = await Promise.all(names.map(async (name) => ({ name, bytes: (await seams.stat(path.join(seams.logsDir, name))).size })));
  for (const file of files) {
    await seams.copyFile(path.join(seams.logsDir, file.name), path.join(targetDir, file.name));
  }
  await seams.writeFile(path.join(targetDir, "meta.json"), JSON.stringify({ appVersion: seams.appVersion, platform: seams.platform, arch: seams.arch, packaged: seams.packaged, generatedAt: now.toISOString(), files }, null, 2), "utf8");
  await seams.openPath(targetDir);
  return targetDir;
}
