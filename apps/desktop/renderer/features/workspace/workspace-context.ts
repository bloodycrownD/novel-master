import type { WorkplaceListRowDto, WorkspacePanelScope } from "@shared/ipc-types";

export type WorkspaceContextTarget =
  | {
      readonly kind: "blank";
      readonly panelScope: WorkspacePanelScope;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "row";
      readonly panelScope: WorkspacePanelScope;
      readonly row: WorkplaceListRowDto;
      readonly x: number;
      readonly y: number;
    };

export function parentPathForTarget(target: WorkspaceContextTarget): string {
  if (target.kind === "blank") {
    return "/";
  }
  return target.row.kind === "dir" ? target.row.path : "/";
}

/**
 * ZIP 子树目标：blank ≡ `/`；目录行（含域根 `/`）为其 path；文件行无 ZIP。
 */
export function zipDirectoryPathForTarget(
  target: WorkspaceContextTarget,
): string | null {
  if (target.kind === "blank") {
    return "/";
  }
  if (target.row.kind === "dir") {
    return target.row.path;
  }
  return null;
}

export function workspaceMenuItems(target: WorkspaceContextTarget): Array<{
  action: string;
  label: string;
  danger?: boolean;
}> {
  if (target.kind === "blank") {
    return [
      { action: "create-file", label: "新建文件" },
      { action: "create-folder", label: "新建文件夹" },
      { action: "import-zip", label: "导入 ZIP" },
      { action: "export-zip", label: "导出 ZIP" },
    ];
  }

  const isDir = target.row.kind === "dir";
  if (isDir) {
    return [
      { action: "create-file", label: "新建文件" },
      { action: "create-folder", label: "新建文件夹" },
      { action: "import-zip", label: "导入 ZIP" },
      { action: "export-zip", label: "导出 ZIP" },
      { action: "rule-config", label: "规则配置" },
      { action: "rename", label: "重命名" },
      { action: "delete", label: "删除文件夹", danger: true },
    ];
  }

  return [
    { action: "file-inclusion", label: "状态设置" },
    { action: "rename", label: "重命名" },
    { action: "delete", label: "删除文件", danger: true },
  ];
}

/** 导入 ZIP 确认文案（子树覆盖语义）。 */
export function zipImportConfirmMessage(directoryPath: string): string {
  if (directoryPath === "/") {
    return "将覆盖目录「当前目录（工作区根）」下的全部文件，同级其他内容不受影响。确定继续？";
  }
  return `将覆盖目录「${directoryPath}」下的全部文件，同级其他内容不受影响。确定继续？`;
}
